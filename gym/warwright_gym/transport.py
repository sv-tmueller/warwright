"""Spawns the Node gym-bridge subprocess
(packages/gym-bridge/dist/main.js) and drives it over the batched NDJSON
protocol it implements (see packages/gym-bridge/src/session.ts). This
module never re-implements any game rule: it only serializes reset/step
requests and returns whatever the Node bridge -- which wraps the unchanged
@warwright/core -- replies with. One request, one response, flushed per
line (see the #63 SUB_PLAN "stdio backpressure" risk note).
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class BridgeError(RuntimeError):
    """Raised when the bridge replies with {"error": ...}, or when the
    bridge subprocess cannot be talked to at all (e.g. it exited)."""


def default_bridge_path() -> Path:
    """packages/gym-bridge/dist/main.js, resolved relative to this file
    (gym/warwright_gym/transport.py -> repo root is two levels up from
    gym/)."""
    return Path(__file__).resolve().parents[2] / "packages" / "gym-bridge" / "dist" / "main.js"


def ensure_bridge_built(path: Path) -> Path:
    """Raises a clear, actionable FileNotFoundError if the compiled
    gym-bridge is missing, instead of a confusing subprocess-spawn failure
    later. Returns `path` unchanged when it exists."""
    if not path.exists():
        raise FileNotFoundError(
            f"gym-bridge is not built: {path} does not exist.\n"
            "Run `pnpm --filter @warwright/gym-bridge build` (or `pnpm build`) "
            "from the repo root first, then re-run the Python suite."
        )
    return path


class Transport:
    """Context-manager lifecycle around one gym-bridge subprocess. Batches
    reset/step requests across many envIds in a single NDJSON round trip;
    the bridge itself holds one SteppedTransport per envId."""

    def __init__(self, bridge_path: Path, *, node: str = "node") -> None:
        self._next_id = 0
        self._process = subprocess.Popen(  # noqa: S603
            [node, str(bridge_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
            universal_newlines=True,
        )

    def __enter__(self) -> Transport:
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()

    def reset(self, envs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """envs: [{"envId": int, "replay": {...}}, ...]. Returns the bridge's
        `envs` list from the response (see session.ts's EnvFrame shape)."""
        response = self._send("reset", envs)
        return response["envs"]

    def step(self, envs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """envs: [{"envId": int, "ticks": int, "actions"?: {unitId: encoded}},
        ...]. Returns the bridge's `envs` list from the response."""
        response = self._send("step", envs)
        return response["envs"]

    def close(self) -> None:
        if self._process.poll() is not None:
            return
        assert self._process.stdin is not None
        try:
            self._process.stdin.write(json.dumps({"cmd": "close"}) + "\n")
            self._process.stdin.flush()
        except (BrokenPipeError, ValueError):
            pass
        try:
            self._process.stdin.close()
        except (BrokenPipeError, ValueError):
            pass
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)

    def _send(self, cmd: str, envs: list[dict[str, Any]]) -> dict[str, Any]:
        assert self._process.stdin is not None
        assert self._process.stdout is not None

        request_id = self._next_id
        self._next_id += 1

        line = json.dumps({"id": request_id, "cmd": cmd, "envs": envs})
        try:
            self._process.stdin.write(line + "\n")
            self._process.stdin.flush()
        except BrokenPipeError as error:
            raise BridgeError(f"bridge process is no longer accepting input: {error}") from error

        response_line = self._process.stdout.readline()
        if response_line == "":
            exit_code = self._process.poll()
            stderr = self._read_stderr()
            raise BridgeError(
                f"bridge closed its stdout unexpectedly (exit code {exit_code}): {stderr}"
            )

        response: dict[str, Any] = json.loads(response_line)
        if response.get("id") != request_id:
            raise BridgeError(
                f"response id {response.get('id')!r} does not match request id {request_id!r}"
            )
        if "error" in response:
            raise BridgeError(str(response["error"]))
        return response

    def _read_stderr(self) -> str:
        if self._process.stderr is None:
            return ""
        try:
            return self._process.stderr.read()
        except Exception:  # noqa: BLE001 - best-effort diagnostic only
            return ""

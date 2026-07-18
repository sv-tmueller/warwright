from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from warwright_gym.transport import Transport, default_bridge_path, ensure_bridge_built


@pytest.fixture()
def bridge_path() -> Path:
    try:
        return ensure_bridge_built(default_bridge_path())
    except FileNotFoundError as error:
        pytest.fail(str(error))


@pytest.fixture()
def transport(bridge_path: Path) -> Iterator[Transport]:
    with Transport(bridge_path) as opened:
        yield opened

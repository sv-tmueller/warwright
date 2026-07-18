"""Python client and Gymnasium environment for the Warwright batched gym
bridge (#63, #64).

This package never re-implements any Warwright rule. It only speaks the
batched NDJSON protocol to packages/gym-bridge/dist/main.js, which itself
wraps the unchanged @warwright/core. See:
  - packages/gym-bridge/src/session.ts (the protocol this client speaks)
  - packages/core/src/sim/observation.ts (the encoder this client mirrors,
    layout constants and action-kind table only, never the math)
  - warwright_gym/env.py (the Gymnasium `VectorEnv`/`Env` wrapper)
  - gym/ENCODING.md (the precise observation/action encoding reference)
"""

from __future__ import annotations

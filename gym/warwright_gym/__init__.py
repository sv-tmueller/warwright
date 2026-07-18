"""Python client for the Warwright batched gym bridge (#63).

This package never re-implements any Warwright rule. It only speaks the
batched NDJSON protocol to packages/gym-bridge/dist/main.js, which itself
wraps the unchanged @warwright/core. See:
  - packages/gym-bridge/src/session.ts (the protocol this client speaks)
  - packages/core/src/sim/observation.ts (the encoder this client mirrors,
    action-kind table only)
"""

from __future__ import annotations

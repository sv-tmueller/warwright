"""Training-only code for #65: a vendored CleanRL-style PPO loop, an
actor-critic MLP policy, a pinned-seed evaluation harness, and a smoke
training-run script. Nothing here is imported by warwright_gym's env,
rewards, featurize, actions, observation, or transport modules -- training
is strictly a consumer of that public surface (CLAUDE.md: gym/ never
re-implements a game rule; only #65's training loop touches torch).
"""

from __future__ import annotations

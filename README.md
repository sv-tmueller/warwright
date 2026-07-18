# Warwright

An autobattler built on one deterministic core. Units are configured (Role, Skills, Behavior) and fight autonomously. Same inputs (ruleset version, seed, two warbands) always produce a byte-identical event log, on every machine and every run. Every runtime (CLI, browser, server, future training gym) wraps this one core and never re-implements combat.

Warwright is original IP. It borrows the architecture of World of Claudecraft (one deterministic core reused across runtimes), not its assets or lore. No tokens, no web3; cosmetics only, much later.

## Status

Phase 0 (the deterministic core and the CLI) is built. Phase 1 (the browser sandbox: a match viewer and a warband builder) is implemented and awaiting its gate. The build runs in five gated phases (see below); each phase is kicked off and approved separately.

## Development

Prerequisites: Node 20 (see [`.nvmrc`](.nvmrc)) and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @warwright/core build
pnpm dev
```

The root `pnpm dev` script launches the browser sandbox's Vite dev server (equivalent to `pnpm --filter @warwright/web dev`). `packages/web` also has its own scripts:

```bash
# start the Vite dev server
pnpm --filter @warwright/web dev
# build the static, hostable bundle (packages/web/dist)
pnpm --filter @warwright/web build
# serve the built bundle locally
pnpm --filter @warwright/web preview
```

Root `pnpm build` (`pnpm -r build`) builds every package, including web.

## Usage

Run a match from the command line with the `sim:run` script:

```bash
pnpm sim:run --seed 42 --a builds/warband-a.json --b builds/warband-b.json
```

It loads the two warband JSON files, runs the deterministic core, and prints a tick-by-tick event log followed by the winner. Output derives only from the event log, so the same seed and builds produce byte-identical stdout on every run and machine.

### Browser sandbox

`packages/web` ships two independent tools:

- **Match viewer** has a setup panel above the canvas: pick a seed (any whole number, defaulting to 42) and a warband for each side, then press "Run match". Each side can be one of the two bundled samples, the warband last saved from the builder, or a JSON file uploaded on the spot through the same validated import path as the builder. Every Run resolves a fresh match and plays it back from tick 0 with the existing play/pause/step controls, a 0.25x-4x speed selector, and a tick seek slider; an invalid seed or warband selection is rejected with an on-screen error and leaves the last valid match running. On first load, the viewer auto-runs seed 42 against the two bundled samples.
- **Warband builder** is a fully offline editor for warbands: add or remove units, pick a role, a behavior, and skills, and place units, all validated live against the core's own Zod schema. A build can be saved to browser storage, exported as JSON, or imported back from a JSON file; exported files use the same layout as `builds/warband-a.json` and `builds/warband-b.json`, so they can be run straight away with `pnpm sim:run --a my-warband.json --b builds/warband-b.json`.

The viewer and the builder are wired together through browser storage: save a build in the builder, then pick "Builder draft" for a side in the viewer's setup panel and press Run to watch it fight without leaving the browser.

Both tools are a pure view over `@warwright/core`: the client calls the core's public API and renders the resulting event log, it never re-implements resolve logic, and it never imports the core's internal `sim` modules directly (an ESLint guard test enforces this). `requestAnimationFrame` only drives rendering; it never touches simulation state.

All default art is procedural, drawn on canvas at runtime from role and skill ids (role is encoded as color and shape, hp as size); no third-party assets are bundled. A CC0 art pack may be added later, but only through the `AssetProvider` adapter, never by coupling art to game or render logic.

### Server

`packages/server` is the Phase 2 authoritative service: a Fastify app over PostgreSQL/Drizzle that depends on `@warwright/core` directly and never re-implements combat or content rules. See [`packages/server/README.md`](packages/server/README.md) for environment variables, the local Postgres docker-compose setup, migrations, and running the server, and for the auth, warband, and matchmaking-queue endpoints themselves.

### Online mode

The browser sandbox also has an **Online** tab (next to **Offline**, which is the match viewer and warband builder above, unchanged) for playing against the authoritative server: register or log in, save the warband builder's draft to your account, pick a saved warband, and join the matchmaking queue. A match is resolved entirely server-side and replayed through the exact same `MatchPlayback` component the offline viewer uses — the client never calls `runMatch`/`runClientMatch` for an online match.

To try it locally, run the server and the web dev server side by side:

```bash
# from the repo root, once: start Postgres and the server (see
# packages/server/README.md for DATABASE_URL / SESSION_SECRET)
docker compose up -d
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/warwright
export SESSION_SECRET=$(openssl rand -hex 32)
pnpm --filter @warwright/server db:migrate
pnpm --filter @warwright/server dev

# in a second terminal: the web dev server
pnpm dev
```

Open the Vite dev server's URL and switch to the **Online** tab. `packages/web/vite.config.ts` proxies `/auth`, `/warbands`, and `/queue` to `http://localhost:3000` (the server's default port), so the client's relative URLs (`api-client.ts` never hardcodes a base URL) stay same-origin in dev — cookie sessions and the CSRF header work with no server-side CORS configuration. Production is expected to serve the web bundle and the API from the same origin (the server serving `packages/web/dist`, or a reverse proxy fronting both); a cross-origin deployment is a separate, out-of-scope server change.

## Build plan

The complete specification lives in [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md). The cross-phase house rules (the determinism contract, cross-surface parity, layout, art and content conventions) live in [`CLAUDE.md`](CLAUDE.md) and are inherited by every session and subagent.

## Phases

- Phase 0: deterministic core and CLI.
- Phase 1: playable browser sandbox (pure view over the core).
- Phase 2: authoritative server and ranked ladder.
- Phase 3: Python training environment and the Foundry.
- Phase 4: content depth, modes, identity, cosmetics-only economy.

Each phase has its own Definition of Done and a human gate. The next phase does not start until the current gate passes. See the roadmap issue on GitHub for the current state.

## Invariants (do not break)

- The simulation in `packages/core/src/sim` is pure: no Node, DOM, network, or rendering imports; one seeded PRNG; integer ticks at 20 Hz; integer combat math.
- A replay is exactly `{ version, seed, buildA, buildB }` and reproduces the full match.
- Cross-surface parity: for a fixed seed and the same builds, the CLI, the browser, and the server produce the same winner and the same event-log hash. The parity test must pass; if it fails, a surface diverged and gets fixed, not the test. The browser leg of this is enforced today by `packages/web/src/match-parity.test.ts`, which compares the client's winner and event-log hash against the core and against the CLI's own load-and-run construction.

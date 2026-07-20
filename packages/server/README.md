# @warwright/server

Fastify + PostgreSQL/Drizzle scaffold for Warwright's authoritative server (Phase 2). Depends on `@warwright/core` directly and never re-implements combat or content rules; it wraps the core.

Auth (register/login/logout/session lifecycle, CSRF, rate limiting) landed in #55. Warband persistence (#56) is below. The authoritative match-resolution primitive (#103, below) landed as a callable module with no HTTP endpoint; the matchmaking queue (#57, below) is the endpoint that calls it. Ratings/history updates are still to come (#58).

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | A `postgresql://` connection string. Parsed and validated (fail-loud) by `src/config.ts`. |
| `PORT` | no | `3000` | HTTP port the Fastify app listens on. |
| `HOST` | no | `0.0.0.0` | Host/interface the Fastify app binds to. |
| `SESSION_SECRET` | yes | — | Signs session cookies and CSRF secrets. At least 32 characters, fail-loud. `docker run` and any deployment now need this set. |
| `COOKIE_SECURE` | no | `false` | Whether session cookies get the `secure` attribute. Leave off for local (non-HTTPS) dev; set `true` in production. |
| `QUEUE_WINDOW_MS` | no | `5000` | Matchmaking batching-window duration (ms) — see Matchmaking queue below. |
| `QUEUE_MAX_POOL` | no | `8` | Pool size (K) that triggers an immediate pairing pass without waiting for the window timer; must be at least 2. |

## Local Postgres (docker-compose)

From the repo root:

```bash
docker compose up -d
```

Starts `postgres:17-alpine`, exposed on host port `5433` by default (override with `WARWRIGHT_PG_PORT`) to avoid colliding with a contributor's own local Postgres on `5432`. Data persists in the named volume `warwright_postgres_data`.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/warwright
```

## Migrations

Schema lives in `src/db/schema.ts` (Drizzle); generated SQL migrations are committed under `drizzle/`.

```bash
# regenerate SQL migrations after changing src/db/schema.ts
pnpm --filter @warwright/server db:generate
# apply pending migrations (idempotent; safe to re-run)
pnpm --filter @warwright/server db:migrate
```

## Running the server

```bash
# watch mode
pnpm --filter @warwright/server dev
# once
pnpm --filter @warwright/server start
```

`GET /healthz` is DB-free (boot smoke test). `GET /readyz` runs `SELECT 1` and is only registered when a database is wired in (see `src/index.ts`).

## Auth

Stateful, server-side sessions: `@fastify/session` backed by a Postgres store (`connect-pg-simple`, pointed at the drizzle-managed `sessions` table — `createTableIfMissing: false`, drizzle stays the schema owner), signed httpOnly cookies via `@fastify/cookie`, CSRF protection via `@fastify/csrf-protection`, and `argon2id` password hashing (OWASP-pinned params) via `argon2`. Stateful sessions (rather than a stateless encrypted cookie) so logout actually revokes the session server-side. Registered only when `db`, `pool`, and `session` are all supplied to `buildApp()` (mirrors `/readyz`'s DB-free-test gating).

Endpoints (all under `/auth`):

| Route | Method | Notes |
| --- | --- | --- |
| `/auth/csrf` | GET | Returns `{ csrfToken }`, tied to the caller's session. Fetch before any mutating auth request. |
| `/auth/register` | POST | `{ email, password }`. 201 + session cookie on success; 409 if the email (case-insensitive) is already registered. Rate-limited (10/min/IP). |
| `/auth/login` | POST | `{ email, password }`. 200 + a freshly regenerated session id (fixation protection) on success; 401 with an identical generic body for both unknown-email and wrong-password. Rate-limited (10/min/IP). |
| `/auth/logout` | POST | Destroys the session server-side and clears the cookie. |
| `/auth/me` | GET | 200 with `{ id, email }` when authenticated, 401 otherwise. |

`/auth/register`, `/auth/login`, and `/auth/logout` require a valid CSRF token, sent as the `csrf-token` header, matching the caller's session; `GET` routes are unaffected. The check runs as an `onRequest` hook, before body parsing, so a `_csrf` field in the request body is never read — the header is the only supported channel. Request bodies are capped at 64 KiB (413 above that) and Zod-validated (400 on malformed input).

Behind a future reverse proxy, `trustProxy` will need to be configured for the rate limiter and cookie `secure` handling to see the real client IP/scheme — out of scope for this slice.

## Warbands

Authenticated CRUD + list for a user's saved warbands, scoped to that account: no cross-account access. Every write is validated with core's own `WarbandSchema` (reused directly as the Fastify request-body schema) plus a set-membership check against core's exported content registry (`roles`, `skills`, `behaviorIds`), so a structurally valid but content-unknown build (an id core doesn't register) is rejected too — it could never be simulated. Stored builds round-trip byte-for-structurally-equal with the CLI/client JSON format (`{ name, units[] }`, e.g. `builds/warband-a.json`); `GET`-by-id responses are themselves re-validated against `WarbandSchema` on the way out, so a corrupted row fails loudly (500) rather than silently serializing something invalid.

Endpoints (all under `/warbands`, all requiring an authenticated session — 401 `{ error: 'Not authenticated' }` otherwise):

| Route | Method | Notes |
| --- | --- | --- |
| `/warbands` | GET | 200, list of `{ id, name, createdAt, updatedAt }` for the caller's own warbands (no `data`). |
| `/warbands` | POST | Body is a `Warband` (`WarbandSchema`). 201 + the full row (incl. `data`) on success; 400 on an illegal build (schema violation, or an unknown `roleId`/`skillId`/`behaviorId`, named in the error message). |
| `/warbands/:id` | GET | 200 + the full row; 400 on a malformed uuid `id`; 404 if the id doesn't exist or belongs to another account (indistinguishable by construction — every query is scoped `WHERE id = :id AND user_id = :sessionUserId`, so foreign rows leak nothing). |
| `/warbands/:id` | PUT | Body is a `Warband`. 200 + the updated row (`updatedAt` advanced) on success; 400/404 as above. |
| `/warbands/:id` | DELETE | 204 (no body) on success; 404 as above. |

`POST`, `PUT`, and `DELETE` additionally require a valid CSRF token (the `csrf-token` header, matching the caller's session) — 403 otherwise, exactly like the mutating `/auth/*` routes. Request bodies are capped at the same 64 KiB limit (413 above it).

## Match resolution

`resolveMatch` (`src/matches/resolve.ts`) is the authoritative match-resolution primitive: a plain async function, not an HTTP route — the matchmaking queue endpoint that will call it is a later slice. Given two build snapshots and a userA/userB pair, it re-validates both builds with core's `parseWarband` (fail-loud), chooses a seed (a `node:crypto` CSPRNG draw in `[0, 2^32)` by default, or a caller-supplied integer in that same range), pins the current `RULESET_VERSION`, calls `core.runMatch` unchanged, and persists one immutable row to `matches` (the canonical `parseWarband` output, not the raw input — so a later edit to the source warband via the `/warbands` routes never touches an already-resolved match). Resolution happens before the insert, so a validation or seed failure persists nothing. It returns `{ matchId, result }`, where `result` is core's full `MatchResult` (winner, event log, hash).

## Matchmaking queue

`POST /queue` submits intent to be matched: `{ warbandId }`, a saved warband owned by the caller (see Warbands above — a foreign or nonexistent id 404s). The queue reads the caller's `ratings` row lazily (`SELECT ... WHERE user_id = :id`; no row means `DEFAULT_RATING` (1500), matching the `ratings.rating` column's own default — nothing is inserted by this read). A second `POST` while already queued (or mid-resolution) is `409 { error: 'Already queued' }`.

**Since #108, `POST /queue` never pairs inline and its response contract is `202`/`404`/`409` only** (no more inline `200 matched`). Every successful enqueue returns `202 { status: 'waiting' }` — pairing happens later, off the request path, in a **batching-window accumulation policy**: waiting players accumulate in a pool until either a timer fires `QUEUE_WINDOW_MS` after the pool becomes pairable (reaches 2 waiters), or the pool reaches `QUEUE_MAX_POOL` (K), whichever comes first. When a pass runs, it sorts the pool FIFO by enqueue order and repeatedly takes the oldest waiter and pairs them with the nearest-rating opponent (the same `selectOpponent` scan as before — nearest rating, FIFO tie-break — now actually decisive over a real multi-candidate pool instead of a single waiter) until fewer than two remain; any odd leftover stays waiting for the next pass. The earlier-enqueued player of each pair is always `A`, its opponent `B`.

This is a forced consequence of any accumulation policy: the joiner's own POST can't carry back a result the window hasn't produced yet. Delivery is through the **existing** `GET /queue` poll below — unchanged, and already what the web client uses (`packages/web`'s POST-`matched` branch becomes dead tolerance code, since the server can no longer return it, but needs no code changes).

Configurable via two env vars (see Environment variables above): `QUEUE_WINDOW_MS` (default `5000`; the client polls `GET /queue` at 2s, so perceived wait is roughly `window + 2s`) and `QUEUE_MAX_POOL` (default `8`, which also bounds a pass's synchronous CPU burst — `resolveMatch` runs a full headless sim per pairing, so K/2 back-to-back resolves at most). A lone waiter gets `202 { status: 'waiting' }` immediately (that *is* "told none is available yet"), can `DELETE /queue`, and is guaranteed to pair within `QUEUE_WINDOW_MS` of a second player joining (or instantly once the pool reaches K). There is no forced queue timeout/expiry in this slice.

Pairing selection ships **nearest-rating** (the selector is unchanged from #57); a hard rating-band cap with an expansion policy (e.g. widen the band the longer someone waits) would additionally guard against pairing wildly mismatched ratings when the pool is thin, but is future work, not implemented here.

`GET /queue` is a side-effect-free status read: `200 { status: 'matched', matchId, result }` (a delivered result is *retained*, not cleared, until the next `POST` — so a dropped response can't strand a completed match), `200 { status: 'waiting' }`, or `200 { status: 'idle' }`.

`DELETE /queue` leaves the queue: `204` if waiting, `404 { error: 'Not queued' }` if idle or already matched, `409 { error: 'Match currently resolving' }` if a pairing is actively resolving.

`POST` and `DELETE` require a valid CSRF token like the other mutating routes above; `POST` is additionally rate-limited (30/minute) — a pairing pass can run several sim resolutions back-to-back (see above), so the limit still guards against enqueue-spam even though POST itself no longer runs a resolution synchronously. `POST`/`GET`/`DELETE` all 401 without a session.

The queue's own clock/timer seam (`src/queue/service.ts`'s `Scheduler` interface) is injectable — production uses real `setTimeout`/`Date.now`; tests inject a manual scheduler with an explicit `fire()` rather than Vitest's `vi.useFakeTimers()`, which would globally stub `setTimeout` under `pg`'s own internal connection timers.

The queue itself (`src/queue/service.ts`) is in-memory and single-process, instantiated fresh per `buildApp()` call — restart loses all waiting/unclaimed state. This is intentional (see the #57 sub-plan): queue entries are ephemeral intent, and every reproducibility guarantee lives in the persisted `matches` rows written by `resolveMatch`, not in the queue. A shared (e.g. Redis-backed) queue store, needed for a multi-instance deployment, is a later concern. `resolveMatch` is called by a resolver callback injected into the queue (constructed in `queue/routes.ts`, wired to `queueRoutes`' own `db`/logger), never through `runMatch` directly — the queue route never re-implements match resolution.

## Tests

```bash
pnpm --filter @warwright/server test
```

DB-gated tests (`src/db/migrations.test.ts`, `src/app.readyz.test.ts`, `src/plugins/session.test.ts`, `src/auth/auth.test.ts`, `src/auth/ratelimit.test.ts`, `src/warbands/warbands.test.ts`, `src/matches/resolve.test.ts`, `src/queue/queue.test.ts`) skip gracefully when `DATABASE_URL` is unset locally, and are mandatory in CI (a `services:` Postgres block; the tests throw if `CI` is set without `DATABASE_URL`, so they can never silently skip there). The test script runs with `--no-file-parallelism`: several DB-gated suites share the same Postgres schema, and `migrations.test.ts` drops and recreates it, so test files must run sequentially rather than racing each other.

## Docker

```bash
# build from the repo root (the image needs pnpm-workspace.yaml, the
# lockfile, and packages/core alongside packages/server)
docker build -f packages/server/Dockerfile -t warwright-server .
docker run --rm -e DATABASE_URL=... -e SESSION_SECRET=... -p 3000:3000 warwright-server
```

The container applies migrations, then starts the server.

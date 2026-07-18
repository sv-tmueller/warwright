# @warwright/server

Fastify + PostgreSQL/Drizzle scaffold for Warwright's authoritative server (Phase 2). Depends on `@warwright/core` directly and never re-implements combat or content rules; it wraps the core.

Auth (register/login/logout/session lifecycle, CSRF, rate limiting) landed in #55. Warband persistence (#56) is below. The authoritative match-resolution primitive (#103, below) landed as a callable module with no HTTP endpoint; the matchmaking queue endpoint that calls it, plus ratings/history, are still to come (#57/#58).

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | A `postgresql://` connection string. Parsed and validated (fail-loud) by `src/config.ts`. |
| `PORT` | no | `3000` | HTTP port the Fastify app listens on. |
| `HOST` | no | `0.0.0.0` | Host/interface the Fastify app binds to. |
| `SESSION_SECRET` | yes | — | Signs session cookies and CSRF secrets. At least 32 characters, fail-loud. `docker run` and any deployment now need this set. |
| `COOKIE_SECURE` | no | `false` | Whether session cookies get the `secure` attribute. Leave off for local (non-HTTPS) dev; set `true` in production. |

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

## Tests

```bash
pnpm --filter @warwright/server test
```

DB-gated tests (`src/db/migrations.test.ts`, `src/app.readyz.test.ts`, `src/plugins/session.test.ts`, `src/auth/auth.test.ts`, `src/auth/ratelimit.test.ts`, `src/warbands/warbands.test.ts`, `src/matches/resolve.test.ts`) skip gracefully when `DATABASE_URL` is unset locally, and are mandatory in CI (a `services:` Postgres block; the tests throw if `CI` is set without `DATABASE_URL`, so they can never silently skip there). The test script runs with `--no-file-parallelism`: several DB-gated suites share the same Postgres schema, and `migrations.test.ts` drops and recreates it, so test files must run sequentially rather than racing each other.

## Docker

```bash
# build from the repo root (the image needs pnpm-workspace.yaml, the
# lockfile, and packages/core alongside packages/server)
docker build -f packages/server/Dockerfile -t warwright-server .
docker run --rm -e DATABASE_URL=... -e SESSION_SECRET=... -p 3000:3000 warwright-server
```

The container applies migrations, then starts the server.

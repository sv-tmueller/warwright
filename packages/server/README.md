# @warwright/server

Fastify + PostgreSQL/Drizzle scaffold for Warwright's authoritative server (Phase 2). Depends on `@warwright/core` directly and never re-implements combat or content rules; it wraps the core.

This slice ships no product endpoints — no auth, matchmaking, or match-resolution routes (those land in #55-#58). It establishes the base schema, migrations, the Fastify app factory, and the local/CI Postgres setup those slices build on.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | A `postgresql://` connection string. Parsed and validated (fail-loud) by `src/config.ts`. |
| `PORT` | no | `3000` | HTTP port the Fastify app listens on. |
| `HOST` | no | `0.0.0.0` | Host/interface the Fastify app binds to. |

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

## Tests

```bash
pnpm --filter @warwright/server test
```

DB-gated tests (`src/db/migrations.test.ts`, `src/app.readyz.test.ts`) skip gracefully when `DATABASE_URL` is unset locally, and are mandatory in CI (a `services:` Postgres block; the tests throw if `CI` is set without `DATABASE_URL`, so they can never silently skip there).

## Docker

```bash
# build from the repo root (the image needs pnpm-workspace.yaml, the
# lockfile, and packages/core alongside packages/server)
docker build -f packages/server/Dockerfile -t warwright-server .
docker run --rm -e DATABASE_URL=... -p 3000:3000 warwright-server
```

The container applies migrations, then starts the server.

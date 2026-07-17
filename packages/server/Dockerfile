# node:20.20.2-slim (glibc, matching .nvmrc), deliberately not alpine: a
# future slice (#55, auth) adds argon2id, whose native build fights musl.
FROM node:20.20.2-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Workspace-aware copy: only what pnpm needs to resolve and install the
# server's dependency graph, plus the core package it depends on at
# runtime (core has no build step; its exports map points at ./src).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core ./packages/core
COPY packages/server ./packages/server

RUN pnpm install --frozen-lockfile --filter @warwright/server...

WORKDIR /app/packages/server

EXPOSE 3000

# Apply migrations, then start the server.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]

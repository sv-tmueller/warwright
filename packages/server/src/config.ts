import { z } from 'zod';
import { DEFAULT_QUEUE_MAX_POOL, DEFAULT_QUEUE_WINDOW_MS } from './queue/service.js';

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  // Signs session cookies and CSRF secrets (@fastify/session /
  // @fastify/csrf-protection); required and fail-loud, no insecure default.
  SESSION_SECRET: z.string().min(32),
  // Whether session cookies get the `secure` attribute. Defaults off so
  // local (non-HTTPS) dev works; production deployments must set it true.
  // z.stringbool() (not z.coerce.boolean(), which coerces any non-empty
  // string via Boolean() — so COOKIE_SECURE=false would misparse as true)
  // reads the string's actual truthiness and fails loud on unrecognized
  // values.
  COOKIE_SECURE: z.stringbool().default(false),
  // Matchmaking batching-window duration (ms); see queue/service.ts's
  // QueueService doc comment and the #108 sub-plan. The client polls GET
  // /queue at 2s, so perceived wait is ~window+2s.
  QUEUE_WINDOW_MS: z.coerce.number().int().positive().default(DEFAULT_QUEUE_WINDOW_MS),
  // Pool size (K) that triggers an immediate pairing pass without waiting
  // for the window timer. Must be at least 2 (a pass needs two entries to
  // ever pair anyone).
  QUEUE_MAX_POOL: z.coerce.number().int().min(2).default(DEFAULT_QUEUE_MAX_POOL),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  sessionSecret: string;
  cookieSecure: boolean;
  queueWindowMs: number;
  queueMaxPool: number;
}

/**
 * Parses the process environment into a validated server Config, throwing
 * loudly (Zod's error) on any missing or malformed value. No silent
 * defaults for required fields, per CLAUDE.md's fail-loud convention.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    host: parsed.HOST,
    sessionSecret: parsed.SESSION_SECRET,
    cookieSecure: parsed.COOKIE_SECURE,
    queueWindowMs: parsed.QUEUE_WINDOW_MS,
    queueMaxPool: parsed.QUEUE_MAX_POOL,
  };
}

import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  // Signs session cookies and CSRF secrets (@fastify/session /
  // @fastify/csrf-protection); required and fail-loud, no insecure default.
  SESSION_SECRET: z.string().min(32),
  // Whether session cookies get the `secure` attribute. Defaults off so
  // local (non-HTTPS) dev works; production deployments must set it true.
  COOKIE_SECURE: z.coerce.boolean().default(false),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  sessionSecret: string;
  cookieSecure: boolean;
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
  };
}

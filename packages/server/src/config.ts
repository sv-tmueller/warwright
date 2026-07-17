import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
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
  };
}

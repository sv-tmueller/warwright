import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const SESSION_SECRET = 'a'.repeat(32);

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      PORT: '4000',
      HOST: '127.0.0.1',
      SESSION_SECRET,
    });

    expect(config).toEqual({
      databaseUrl: 'postgresql://user:pass@localhost:5432/warwright',
      port: 4000,
      host: '127.0.0.1',
      sessionSecret: SESSION_SECRET,
      cookieSecure: false,
      queueWindowMs: 5000,
      queueMaxPool: 8,
      queueMaxFailures: 3,
      queueMaxAgeMs: 60_000,
    });
  });

  it('defaults PORT to 3000 and HOST to 0.0.0.0', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
    });

    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
  });

  it('defaults COOKIE_SECURE to false and parses "true"', () => {
    const insecure = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
    });
    expect(insecure.cookieSecure).toBe(false);

    const secure = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
      COOKIE_SECURE: 'true',
    });
    expect(secure.cookieSecure).toBe(true);
  });

  it('parses COOKIE_SECURE="false" as false (not a truthy non-empty string)', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
      COOKIE_SECURE: 'false',
    });
    expect(config.cookieSecure).toBe(false);
  });

  it('throws loudly when COOKIE_SECURE is not a recognized boolean string', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        COOKIE_SECURE: 'banana',
      })
    ).toThrow();
  });

  it('throws loudly when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ SESSION_SECRET })).toThrow();
  });

  it('throws loudly when DATABASE_URL is not a valid URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not-a-url', SESSION_SECRET })).toThrow();
  });

  it('throws loudly when PORT is not numeric', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        PORT: 'not-a-number',
        SESSION_SECRET,
      })
    ).toThrow();
  });

  it('throws loudly when SESSION_SECRET is missing', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright' })
    ).toThrow();
  });

  it('throws loudly when SESSION_SECRET is shorter than 32 characters', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET: 'too-short',
      })
    ).toThrow();
  });

  it('defaults QUEUE_WINDOW_MS to 5000 and QUEUE_MAX_POOL to 8', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
    });
    expect(config.queueWindowMs).toBe(5000);
    expect(config.queueMaxPool).toBe(8);
  });

  it('parses explicit QUEUE_WINDOW_MS and QUEUE_MAX_POOL', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
      QUEUE_WINDOW_MS: '2500',
      QUEUE_MAX_POOL: '4',
    });
    expect(config.queueWindowMs).toBe(2500);
    expect(config.queueMaxPool).toBe(4);
  });

  it('throws loudly when QUEUE_WINDOW_MS is not a positive integer', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        QUEUE_WINDOW_MS: '0',
      })
    ).toThrow();
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        QUEUE_WINDOW_MS: 'not-a-number',
      })
    ).toThrow();
  });

  it('throws loudly when QUEUE_MAX_POOL is below 2 (K must allow at least one pairing)', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        QUEUE_MAX_POOL: '1',
      })
    ).toThrow();
  });

  it('defaults QUEUE_MAX_FAILURES to 3 and QUEUE_MAX_AGE_MS to 60000', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
    });
    expect(config.queueMaxFailures).toBe(3);
    expect(config.queueMaxAgeMs).toBe(60_000);
  });

  it('parses explicit QUEUE_MAX_FAILURES and QUEUE_MAX_AGE_MS', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      SESSION_SECRET,
      QUEUE_MAX_FAILURES: '5',
      QUEUE_MAX_AGE_MS: '120000',
    });
    expect(config.queueMaxFailures).toBe(5);
    expect(config.queueMaxAgeMs).toBe(120_000);
  });

  it('throws loudly when QUEUE_MAX_FAILURES is below 1', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        QUEUE_MAX_FAILURES: '0',
      })
    ).toThrow();
  });

  it('throws loudly when QUEUE_MAX_AGE_MS is not a positive integer', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        QUEUE_MAX_AGE_MS: '0',
      })
    ).toThrow();
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        SESSION_SECRET,
        QUEUE_MAX_AGE_MS: 'not-a-number',
      })
    ).toThrow();
  });
});

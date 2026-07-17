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
});

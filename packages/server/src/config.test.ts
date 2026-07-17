import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
      PORT: '4000',
      HOST: '127.0.0.1',
    });

    expect(config).toEqual({
      databaseUrl: 'postgresql://user:pass@localhost:5432/warwright',
      port: 4000,
      host: '127.0.0.1',
    });
  });

  it('defaults PORT to 3000 and HOST to 0.0.0.0', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
    });

    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
  });

  it('throws loudly when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('throws loudly when DATABASE_URL is not a valid URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'not-a-url' })).toThrow();
  });

  it('throws loudly when PORT is not numeric', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warwright',
        PORT: 'not-a-number',
      })
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing (argon2id)', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects verification against the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });

  it('produces an argon2id-tagged hash string', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const hashA = await hashPassword('correct horse battery staple');
    const hashB = await hashPassword('correct horse battery staple');

    expect(hashA).not.toBe(hashB);
  });
});

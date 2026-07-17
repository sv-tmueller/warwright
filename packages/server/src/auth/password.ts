import * as argon2 from 'argon2';

// OWASP-pinned argon2id minimums (Password Storage Cheat Sheet): m=19456
// KiB (~19 MiB), t=2, p=1. Pinning parameters is not hand-rolled crypto —
// the hashing itself is delegated entirely to the `argon2` binding.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashes a plaintext password with argon2id using OWASP-pinned params. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/** Verifies a plaintext password against a previously produced argon2 hash. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

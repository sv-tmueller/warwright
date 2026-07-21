import { describe, expect, it } from 'vitest';
import { noopEntitlementProvider, type EntitlementProvider } from './entitlement.js';

describe('noopEntitlementProvider', () => {
  it('grants exactly the requested cosmeticId (never a random/different one)', async () => {
    const result = await noopEntitlementProvider.grantEntitlement({
      userId: 'user-1',
      cosmeticId: 'palette-crimson',
    });
    expect(result).toEqual({ granted: true, cosmeticId: 'palette-crimson' });
  });

  it('is idempotent across repeated calls for the same input: same requested id every time', async () => {
    const first = await noopEntitlementProvider.grantEntitlement({
      userId: 'user-1',
      cosmeticId: 'banner-laurel',
    });
    const second = await noopEntitlementProvider.grantEntitlement({
      userId: 'user-1',
      cosmeticId: 'banner-laurel',
    });
    expect(first).toEqual({ granted: true, cosmeticId: 'banner-laurel' });
    expect(second).toEqual({ granted: true, cosmeticId: 'banner-laurel' });
  });

  it('exposes no random-draw surface: the interface has exactly one method, grantEntitlement', () => {
    const provider: EntitlementProvider = noopEntitlementProvider;
    expect(Object.keys(provider)).toEqual(['grantEntitlement']);
    expect('grantRandom' in provider).toBe(false);
    expect('draw' in provider).toBe(false);
  });
});

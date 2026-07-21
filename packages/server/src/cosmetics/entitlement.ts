// Payment/entitlement seam (#73): every future payment integration (Stripe,
// PayPal, web3, whatever) must implement this interface and stay entirely
// behind it — no payment SDK is imported anywhere else in this codebase.
// This slice ships exactly one implementation, `noopEntitlementProvider`,
// which grants for free with no external call.
//
// The interface is entitlement-shaped, not money-shaped: it takes a specific,
// caller-named cosmeticId and can only ever grant that same id back. There is
// deliberately no `grantRandom()` / loot-box surface — a provider cannot
// express "grant something the caller didn't ask for," which is what makes a
// randomized-draw purchase mechanic structurally inexpressible here, not
// merely unused. See entitlement.test.ts's "exposes no random-draw surface"
// assertion.

export interface GrantEntitlementInput {
  userId: string;
  cosmeticId: string;
}

export type EntitlementResult =
  | { granted: true; cosmeticId: string }
  | { granted: false; reason: string };

export interface EntitlementProvider {
  grantEntitlement(input: GrantEntitlementInput): Promise<EntitlementResult>;
}

/**
 * The only entitlement provider this slice ships: grants the caller-named
 * cosmeticId unconditionally, with no charge and no external call. A real
 * payment provider would call out to a payment API here and return
 * `{granted: false, reason}` on a declined charge; this one never declines.
 */
export const noopEntitlementProvider: EntitlementProvider = {
  async grantEntitlement(input) {
    return { granted: true, cosmeticId: input.cosmeticId };
  },
};

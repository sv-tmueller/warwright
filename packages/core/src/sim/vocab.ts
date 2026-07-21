// Shared vocabulary for engine and content. Frozen contract: downstream
// (content schemas, events) consumes these and does not extend them here.
export const STATUS_KINDS = ['slow', 'shield', 'dot', 'stun', 'empower'] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export const EFFECT_KINDS = ['direct-damage', 'heal', 'apply-status'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * AssetProvider adapter (CLAUDE.md, Art conventions): "A CC0 pack may be
 * added later only through the AssetProvider adapter, never by coupling art
 * to game or render logic."
 *
 * The interface mirrors the four pure draw functions from ../art/index.js
 * 1:1, reusing their exported param types and DrawContext so the two never
 * drift apart. `proceduralProvider` delegates straight to those functions
 * and is the only active provider today.
 *
 * `resolveAssetProvider` is the off-by-default pack slot: it is a pure
 * selector, `override ?? proceduralProvider`, not a mutable global. A future
 * asset pack registers by passing its own AssetProvider as the override;
 * until then nothing but the procedural default ever runs.
 *
 * Candidate sources for a future pack (documented only, nothing bundled,
 * see docs/BUILD_PLAN.md Section C):
 * - Kenney.nl, CC0, no attribution required. Sprites and UI.
 * - game-icons.net, CC BY 3.0, attribution required. Ability icons.
 */
import type {
  DrawBarParams,
  DrawContext,
  DrawRoleSilhouetteParams,
  DrawSkillIconParams,
  DrawStatusIndicatorParams,
} from '../art/index.js';
import { drawBar, drawRoleSilhouette, drawSkillIcon, drawStatusIndicator } from '../art/index.js';

export interface AssetProvider {
  drawRoleSilhouette(ctx: DrawContext, params: DrawRoleSilhouetteParams): void;
  drawSkillIcon(ctx: DrawContext, params: DrawSkillIconParams): void;
  drawBar(ctx: DrawContext, params: DrawBarParams): void;
  drawStatusIndicator(ctx: DrawContext, params: DrawStatusIndicatorParams): void;
}

export const proceduralProvider: AssetProvider = {
  drawRoleSilhouette,
  drawSkillIcon,
  drawBar,
  drawStatusIndicator,
};

/** Off-by-default pack slot: with no override, the procedural default runs. */
export function resolveAssetProvider(override?: AssetProvider): AssetProvider {
  return override ?? proceduralProvider;
}

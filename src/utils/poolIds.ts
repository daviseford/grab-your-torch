import type { PoolId, Season } from "../types";

/**
 * Pool document ids, derived the same way `scripts/create-pool.ts` derives
 * them. The derivation is duplicated rather than shared because the script
 * runs under the Admin SDK with node types and this module ships in the
 * browser bundle; the shape is one template literal and both sides are
 * covered by tests.
 */
export const poolIdForSeason = (seasonNum: number): PoolId =>
  `pool_season_${seasonNum}`;

const SEASON_ID_PATTERN = /^season_(\d+)$/;

/**
 * The season number inside a `season_${n}` id, or null when the route
 * parameter is not one. Returning null rather than NaN keeps a junk path
 * segment from being interpolated into a Firestore document path.
 */
export const seasonNumFromSeasonId = (
  seasonId: string | undefined,
): number | null => {
  if (!seasonId) return null;
  const match = SEASON_ID_PATTERN.exec(seasonId);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/** The `season_${n}` id for a season number. */
export const seasonIdForNum = (seasonNum: number): Season["id"] =>
  `season_${seasonNum}`;

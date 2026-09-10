import { SEASON_51_PLAYERS } from "../../data/season_51";
import type { CastawayId, Player, Season } from "../../types";

/**
 * Decoration for the entry picker: portraits and cast bios.
 *
 * The pool configuration document is the authority for WHO is in the pool and
 * for the exact name string an entry submits (KTD3, R23). It carries only
 * `{castaway_id, full_name}`, and season 51 is deliberately absent from
 * Firestore, so `useSeason` returns nothing. This module joins the stored
 * roster against the local season module purely for the portrait and the age
 * or hometown line.
 *
 * A castaway with no local match degrades to a text card. That is not
 * hypothetical: season 51's ids are provisional predictions, and the day
 * survivoR publishes real ids every one of these lookups misses until the
 * season module is regenerated. Missing decoration must never break the page.
 *
 * Keyed by season id rather than hardcoded to 51, but only season 51 has a
 * pool, so only that module is imported. Adding a season here adds its player
 * array to the lazily loaded pool chunk, and nothing else.
 *
 * DO NOT import this module from anything reachable by
 * `src/components/Home/Home.tsx`: the import-boundary test forbids the
 * homepage reaching season data transitively, and this module is exactly that
 * edge.
 */
const CAST_BY_SEASON: Partial<Record<Season["id"], readonly Player[]>> = {
  season_51: SEASON_51_PLAYERS,
};

export type PoolCastDetail = {
  img?: string;
  age?: number;
  profession?: string;
  hometown?: string;
  description?: string;
};

/**
 * A lookup from castaway id to decoration, or an always-empty one for a season
 * whose module is not bundled here.
 */
export const buildPoolCastDetails = (
  seasonId: Season["id"] | undefined,
): Map<CastawayId, PoolCastDetail> => {
  const players = seasonId ? CAST_BY_SEASON[seasonId] : undefined;
  const details = new Map<CastawayId, PoolCastDetail>();
  if (!players) return details;
  for (const player of players) {
    details.set(player.castaway_id, {
      img: player.img,
      age: player.age,
      profession: player.profession,
      hometown: player.hometown,
      description: player.description,
    });
  }
  return details;
};

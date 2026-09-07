import type { CastawayLookup, Player } from "../types";

/**
 * The name a castaway is shown under: the on-screen "castaway" name from the
 * season's lookup, falling back to the player's full name.
 */
export const castawayDisplayName = (
  player: Pick<Player, "castaway_id" | "full_name">,
  lookup?: CastawayLookup,
): string => lookup?.[player.castaway_id]?.castaway || player.full_name;

const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * A season's cast in alphabetical order by display name, then full name.
 *
 * Season data arrives from survivoR in boot order (first boot to winner),
 * which spoils the season for anyone browsing the cast. Every full-cast
 * listing outside a results context should render this order instead.
 * Returns a new array; the input is not mutated.
 */
export const sortCastAlphabetically = <
  P extends Pick<Player, "castaway_id" | "full_name">,
>(
  players: readonly P[],
  lookup?: CastawayLookup,
): P[] =>
  [...players].sort(
    (a, b) =>
      compareNames(
        castawayDisplayName(a, lookup),
        castawayDisplayName(b, lookup),
      ) ||
      compareNames(a.full_name, b.full_name) ||
      a.castaway_id.localeCompare(b.castaway_id),
  );

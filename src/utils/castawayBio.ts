import { SEASON_51_BIOS, type CastawayBio } from "../data/castawayBios";
import demographics from "../data/castawayDemographics.json";
import type { Player } from "../types";

const details: Record<string, { name: string; gender: string }> =
  demographics.players;

export function getCastawayBio(player: Player): CastawayBio {
  const curated =
    player.season_num === 51 ? SEASON_51_BIOS[player.full_name] : undefined;
  const demographic = details[player.castaway_id];
  // Historical IDs survive name changes. Season 51 IDs remain provisional.
  const gender =
    player.season_num < 51 || demographic?.name === player.full_name
      ? demographic?.gender
      : undefined;
  return {
    hometown: player.hometown,
    ...curated,
    gender: gender ?? player.gender ?? curated?.gender,
    sources:
      curated?.sources ??
      (gender
        ? [{ label: "survivoR castaway data", url: demographics.source }]
        : undefined),
  };
}

/** Receives the episode-scoped roster, including eliminated owners, excluding incoming previews. */
export function rosterGenderBreakdown(players: readonly Player[]): string {
  if (!players.length) return "";
  const counts = new Map<string, number>([
    ["male", 0],
    ["female", 0],
  ]);
  for (const player of players) {
    const gender =
      getCastawayBio(player).gender?.trim().toLowerCase() || "unspecified";
    counts.set(gender, (counts.get(gender) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count]) => `${count} ${label}`).join(
    " · ",
  );
}

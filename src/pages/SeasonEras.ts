import type { SeasonMeta } from "../data/season-metadata";

/** Era bands used by the catalog's segmented control and the tile meta. */
export const SEASON_ERAS = [
  { id: "classic", label: "Classic", range: "1–8", min: 1, max: 8 },
  { id: "middle", label: "Middle", range: "9–20", min: 9, max: 20 },
  { id: "modern", label: "Modern", range: "21–33", min: 21, max: 33 },
  { id: "new", label: "New Era", range: "34–50", min: 34, max: 50 },
] as const;

export type SeasonEraId = (typeof SEASON_ERAS)[number]["id"];

export const getSeasonEra = (order: number) =>
  SEASON_ERAS.find((era) => order >= era.min && order <= era.max) ??
  SEASON_ERAS[SEASON_ERAS.length - 1];

export function getSeasonDisplayTitle(meta: SeasonMeta): string {
  if (/\d/.test(meta.name)) return meta.name;

  const label = meta.subtitle ?? meta.name.replace(/^Survivor:\s*/, "");
  return `S${meta.order}: ${label}`;
}

/**
 * Season 50's registered webp carries a baked white field that breaks the
 * navy art plate; the png beside it is the clean mark. Resolved here rather
 * than in src/data so the catalog and the homepage agree.
 */
const ART_OVERRIDES: Partial<Record<SeasonMeta["id"], string>> = {
  season_50: "/images/season_50/season-50-logo.png",
};

export const getSeasonArt = (meta: SeasonMeta) =>
  ART_OVERRIDES[meta.id] ?? meta.img;

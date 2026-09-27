/**
 * The season logo written to `seasons/{id}.img`.
 *
 * `src/data/seasons.ts` is where a logo is set on purpose, so a non-empty
 * value there always wins, including a changed one. A season registered
 * without a logo (the automated bootstrap writes `img: ""`) must not blank a
 * logo that Firestore already holds, so an empty local value keeps it.
 */

import * as path from "path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const SEASONS_FILE_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "data",
  "seasons.ts",
);

/**
 * Read `img` from the season's entry in the seasons.ts source. The match
 * stops at the entry's closing brace, so an entry without `img` reads as ""
 * rather than borrowing the next season's logo.
 */
export function readLocalSeasonImg(
  seasonsFileContent: string,
  seasonNum: number,
): string {
  const match = seasonsFileContent.match(
    new RegExp(`\\bseason_${seasonNum}:\\s*\\{[^}]*?\\bimg:\\s*"([^"]*)"`),
  );
  return match?.[1] ?? "";
}

export function resolveSeasonImg(
  localImg: string,
  existingImg: unknown,
): string {
  if (localImg) return localImg;
  return typeof existingImg === "string" ? existingImg : "";
}

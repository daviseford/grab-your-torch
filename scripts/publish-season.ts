/**
 * Publish one committed season file to Firestore.
 *
 * The survivoR observer runs this after a reviewed sync pull request has
 * merged, from a checkout of the merged commit, so production only ever
 * receives season data that is on `main`. It is the same write the old
 * sync made before review (lib/firebase-push.ts), including the castaway id
 * cutover gate and the stored-logo rule. Pushing an unchanged file again is
 * harmless, so a failed publish can simply be re-run.
 *
 * Usage: yarn tsx scripts/publish-season.ts <season_number> [--dry-run]
 */

import * as fs from "fs";
import { pushSeasonToFirestore } from "./lib/firebase-push.js";
import { readLocalSeasonImg, SEASONS_FILE_PATH } from "./lib/season-img.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const seasonArg = args.find((a) => !a.startsWith("--"));
  const seasonNum = Number(seasonArg);
  if (!seasonArg || !Number.isInteger(seasonNum) || seasonNum < 1) {
    throw new Error(
      "Usage: yarn tsx scripts/publish-season.ts <season_number> [--dry-run]",
    );
  }
  const seasonsFile = fs.readFileSync(SEASONS_FILE_PATH, "utf-8");
  await pushSeasonToFirestore(
    seasonNum,
    dryRun,
    readLocalSeasonImg(seasonsFile, seasonNum),
  );
}

main().catch((err) => {
  console.error("Publish failed:", err);
  process.exit(1);
});

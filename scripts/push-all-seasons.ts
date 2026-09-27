/**
 * Push all registered seasons to Firestore.
 *
 * Reads src/data/seasons.ts to discover every registered season,
 * then calls pushSeasonToFirestore for each one.
 *
 * Usage: yarn push-all-seasons [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import { pushSeasonToFirestore } from "./lib/firebase-push.js";
import { readLocalSeasonImg } from "./lib/season-img.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

/** Parse registered season numbers from the seasons file content. */
function getRegisteredSeasons(content: string): number[] {
  const matches = [...content.matchAll(/season_(\d+):/g)];
  return matches.map((m) => Number(m[1])).sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const seasonsFilePath = path.join(PROJECT_ROOT, "src", "data", "seasons.ts");
  const seasonsContent = fs.readFileSync(seasonsFilePath, "utf-8");
  const seasonNums = getRegisteredSeasons(seasonsContent);

  console.log(
    `Found ${seasonNums.length} registered seasons: ${seasonNums.join(", ")}`,
  );
  if (dryRun) {
    console.log("[DRY RUN] Will log what would be pushed without writing.\n");
  }

  const failures: number[] = [];

  for (const seasonNum of seasonNums) {
    const seasonImg = readLocalSeasonImg(seasonsContent, seasonNum);
    console.log(`\n--- Season ${seasonNum} ---`);

    try {
      await pushSeasonToFirestore(seasonNum, dryRun, seasonImg);
    } catch (err) {
      failures.push(seasonNum);
      console.error(
        `  [ERROR] Season ${seasonNum} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const succeeded = seasonNums.length - failures.length;
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Done. ${succeeded} succeeded, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log(`Failed seasons: ${failures.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Push all seasons failed:", err);
  process.exit(1);
});

/**
 * Push existing local season data to Firestore without regenerating.
 *
 * Useful when local data files have been updated (e.g., transformer improvements)
 * but Firestore hasn't been re-synced. Pushes all collections (seasons, challenges,
 * eliminations, events) for each specified season.
 *
 * Usage:
 *   yarn tsx scripts/push-seasons.ts                    # push all seasons with local data
 *   yarn tsx scripts/push-seasons.ts 47 48 49           # push specific seasons
 *   yarn tsx scripts/push-seasons.ts --dry-run          # preview without writing
 *   yarn tsx scripts/push-seasons.ts --collections events  # push only events collection
 *   yarn tsx scripts/push-seasons.ts --collections events,challenges  # push specific collections
 */

import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import "./lib/admin.js";
import {
  type Collection,
  getSeasonDataPath,
  pushSeason,
  VALID_COLLECTIONS,
} from "./lib/push-season-collections.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

function discoverSeasons(): number[] {
  const dataDir = path.join(PROJECT_ROOT, "src", "data");
  return fs
    .readdirSync(dataDir)
    .filter((d) => d.startsWith("season_"))
    .map((d) => Number(d.replace("season_", "")))
    .filter((n) => !isNaN(n) && fs.existsSync(getSeasonDataPath(n)))
    .sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  const positional: number[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      flags.set("dry-run", "true");
    } else if (args[i] === "--collections" && args[i + 1]) {
      flags.set("collections", args[++i]);
    } else if (!args[i].startsWith("--")) {
      const n = Number(args[i]);
      if (!isNaN(n)) positional.push(n);
    }
  }

  const dryRun = flags.has("dry-run");
  const collectionsStr = flags.get("collections");
  const collections = new Set<Collection>(
    collectionsStr
      ? (collectionsStr
          .split(",")
          .filter((c) =>
            (VALID_COLLECTIONS as readonly string[]).includes(c),
          ) as Collection[])
      : [...VALID_COLLECTIONS],
  );

  if (collections.size === 0) {
    console.error(
      `No valid collections specified. Valid: ${VALID_COLLECTIONS.join(", ")}`,
    );
    process.exit(1);
  }

  const seasonNums =
    positional.length > 0
      ? positional.sort((a, b) => a - b)
      : discoverSeasons();

  console.log(`Pushing ${seasonNums.length} season(s) to Firestore`);
  console.log(`  Collections: ${[...collections].join(", ")}`);
  if (dryRun) console.log("  [DRY RUN — no writes]");

  let totalPushed = 0;
  let totalFailed = 0;

  for (const seasonNum of seasonNums) {
    const dataPath = getSeasonDataPath(seasonNum);
    if (!fs.existsSync(dataPath)) {
      console.log(`  Season ${seasonNum}: no local data file — skipping`);
      continue;
    }

    console.log(`  Season ${seasonNum}:`);
    const result = await pushSeason(
      dryRun ? null : getFirestore(),
      seasonNum,
      collections,
      dryRun,
    );
    totalPushed += result.pushed.length;
    totalFailed += result.failed.length;

    if (!dryRun && result.pushed.length > 0) {
      console.log(
        `    [OK] ${result.pushed.map((p) => p.split("/")[0]).join(", ")}`,
      );
    }
    if (result.failed.length > 0) {
      console.log(`    [FAIL] ${result.failed.join(", ")}`);
    }
  }

  console.log(`\nDone. Pushed: ${totalPushed}, Failed: ${totalFailed}`);
  if (totalFailed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Push failed:", err);
    process.exit(1);
  });

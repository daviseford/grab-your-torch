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
import { buildSeasonDocument } from "./lib/season-document.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const VALID_COLLECTIONS = [
  "seasons",
  "challenges",
  "eliminations",
  "events",
  "vote_history",
] as const;
type Collection = (typeof VALID_COLLECTIONS)[number];

function getSeasonExport(
  mod: Record<string, unknown>,
  seasonNum: number,
  suffix: string,
): unknown {
  return mod[`SEASON_${seasonNum}_${suffix}`];
}

function getSeasonDataPath(seasonNum: number): string {
  return path.resolve(
    PROJECT_ROOT,
    "src",
    "data",
    `season_${seasonNum}`,
    "index.ts",
  );
}

function discoverSeasons(): number[] {
  const dataDir = path.join(PROJECT_ROOT, "src", "data");
  return fs
    .readdirSync(dataDir)
    .filter((d) => d.startsWith("season_"))
    .map((d) => Number(d.replace("season_", "")))
    .filter((n) => !isNaN(n) && fs.existsSync(getSeasonDataPath(n)))
    .sort((a, b) => a - b);
}

async function pushSeason(
  seasonNum: number,
  collections: Set<Collection>,
  dryRun: boolean,
): Promise<{ pushed: string[]; skipped: string[]; failed: string[] }> {
  const seasonKey = `season_${seasonNum}`;
  const seasonDataPath = getSeasonDataPath(seasonNum);

  const mod = await import(
    new URL(`file:///${seasonDataPath.replace(/\\/g, "/")}`).href
  );

  const players = getSeasonExport(mod, seasonNum, "PLAYERS");
  const episodes = getSeasonExport(mod, seasonNum, "EPISODES");
  const challenges = getSeasonExport(mod, seasonNum, "CHALLENGES");
  const eliminations = getSeasonExport(mod, seasonNum, "ELIMINATIONS");
  const events = getSeasonExport(mod, seasonNum, "EVENTS");
  const voteHistory = getSeasonExport(mod, seasonNum, "VOTE_HISTORY");
  const castawayLookup = getSeasonExport(mod, seasonNum, "CASTAWAY_LOOKUP");

  const allDocs: { collection: Collection; data: Record<string, unknown> }[] = [
    {
      collection: "seasons",
      data: buildSeasonDocument({
        seasonNum,
        seasonImg: "",
        players: players || [],
        episodes: episodes || [],
        castawayLookup: castawayLookup || {},
        challenges,
        eliminations,
        events,
      }),
    },
    {
      collection: "challenges",
      data: (challenges || {}) as Record<string, unknown>,
    },
    {
      collection: "eliminations",
      data: (eliminations || {}) as Record<string, unknown>,
    },
    {
      collection: "events",
      data: (events || {}) as Record<string, unknown>,
    },
    {
      collection: "vote_history",
      data: (voteHistory || {}) as Record<string, unknown>,
    },
  ];

  const seasonDoc = allDocs[0].data;
  console.log(
    `    revisions: data ${seasonDoc.data_revision}, scoring ${seasonDoc.scoring_revision}`,
  );

  const pushed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  const db = dryRun ? null : getFirestore();

  const selectedDocs = allDocs.filter((doc) => collections.has(doc.collection));

  for (const doc of allDocs) {
    const docPath = `${doc.collection}/${seasonKey}`;

    if (!collections.has(doc.collection)) {
      skipped.push(docPath);
      continue;
    }

    if (dryRun) {
      const entryCount = Object.keys(doc.data).length;
      console.log(`    [DRY RUN] ${docPath} (${entryCount} entries)`);
      pushed.push(docPath);
      continue;
    }
  }

  if (!dryRun && selectedDocs.length > 0) {
    const batch = db!.batch();
    for (const doc of selectedDocs) {
      batch.set(db!.collection(doc.collection).doc(seasonKey), doc.data);
    }

    try {
      await batch.commit();
      pushed.push(
        ...selectedDocs.map((doc) => `${doc.collection}/${seasonKey}`),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    [FAIL] season ${seasonNum}: ${msg}`);
      failed.push(
        ...selectedDocs.map((doc) => `${doc.collection}/${seasonKey}`),
      );
    }
  }

  return { pushed, skipped, failed };
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
    const result = await pushSeason(seasonNum, collections, dryRun);
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

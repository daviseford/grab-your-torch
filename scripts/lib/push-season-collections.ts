/**
 * Push a bundled season's documents (the season document and its result
 * collections) to Firestore, for `scripts/push-seasons.ts`. Kept apart from
 * the script so the write path, including its castaway id remap gate, can be
 * tested against the emulator: the script initializes the Admin SDK on import.
 */

import type { Firestore } from "firebase-admin/firestore";
import * as path from "path";
import { seasonPushGate } from "./remap-ledger.js";
import { buildSeasonDocument } from "./season-document.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const VALID_COLLECTIONS = [
  "seasons",
  "challenges",
  "eliminations",
  "events",
  "vote_history",
] as const;
export type Collection = (typeof VALID_COLLECTIONS)[number];

function getSeasonExport(
  mod: Record<string, unknown>,
  seasonNum: number,
  suffix: string,
): unknown {
  return mod[`SEASON_${seasonNum}_${suffix}`];
}

export function getSeasonDataPath(seasonNum: number): string {
  return path.resolve(
    PROJECT_ROOT,
    "src",
    "data",
    `season_${seasonNum}`,
    "index.ts",
  );
}

export async function pushSeason(
  db: Firestore | null,
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
    // The same gate as pushSeasonToFirestore: result collections carry
    // castaway ids too, so no route may push them mid-cutover or from the
    // wrong side of a remap.
    const refusal = await seasonPushGate(db!, seasonNum, castawayLookup);
    if (refusal) {
      console.error(`    [REFUSED] season ${seasonNum}: ${refusal}`);
      failed.push(
        ...selectedDocs.map((doc) => `${doc.collection}/${seasonKey}`),
      );
      return { pushed, skipped, failed };
    }
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

/**
 * Push generated season data to Firestore using Firebase Admin SDK.
 * Reuses the shared admin init from ./admin.ts.
 */

import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

// Import to trigger shared Firebase Admin initialization
import "./admin.js";
import {
  commitSeasonPush,
  describeSeasonImg,
} from "./push-season-collections.js";
import { buildSeasonDocument } from "./season-document.js";

interface FirestoreDocument {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
}

function getSeasonExport(
  mod: Record<string, unknown>,
  seasonNum: number,
  suffix: string,
): unknown {
  return mod[`SEASON_${seasonNum}_${suffix}`];
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export async function pushSeasonToFirestore(
  seasonNum: number,
  dryRun = false,
  seasonImg = "",
): Promise<void> {
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");
  const seasonKey = `season_${seasonNum}`;
  const seasonDataPath = path.resolve(
    projectRoot,
    "src",
    "data",
    seasonKey,
    "index.ts",
  );

  if (!fs.existsSync(seasonDataPath)) {
    throw new Error(
      `Season data file not found at ${seasonDataPath}. Generate it first.`,
    );
  }

  // Use file:// URL for Windows compatibility with dynamic import
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

  if (!players || !episodes) {
    throw new Error(
      `Missing required exports (SEASON_${seasonNum}_PLAYERS, SEASON_${seasonNum}_EPISODES) in ${seasonDataPath}`,
    );
  }

  const documents: FirestoreDocument[] = [
    {
      collection: "seasons",
      docId: seasonKey,
      data: buildSeasonDocument({
        seasonNum,
        seasonImg,
        players,
        episodes,
        castawayLookup: castawayLookup || {},
        challenges,
        eliminations,
        events,
      }),
    },
    {
      collection: "challenges",
      docId: seasonKey,
      data: (challenges || {}) as Record<string, unknown>,
    },
    {
      collection: "eliminations",
      docId: seasonKey,
      data: (eliminations || {}) as Record<string, unknown>,
    },
    {
      collection: "events",
      docId: seasonKey,
      data: (events || {}) as Record<string, unknown>,
    },
    {
      collection: "vote_history",
      docId: seasonKey,
      data: (voteHistory || {}) as Record<string, unknown>,
    },
  ];

  const seasonDoc = documents[0].data;

  if (dryRun) {
    console.log(`\n[DRY RUN] Would upload the following to Firestore:\n`);
    for (const doc of documents) {
      const preview = truncate(JSON.stringify(doc.data, null, 2), 200);
      console.log(`  ${doc.collection}/${doc.docId}:`);
      console.log(`    ${preview}\n`);
    }
    console.log(`  seasons/${seasonKey} revisions:`);
    console.log(`    data_revision:    ${seasonDoc.data_revision}`);
    console.log(`    scoring_revision: ${seasonDoc.scoring_revision}`);
    console.log(`    img:              ${describeSeasonImg(seasonImg)}\n`);
    return;
  }

  const db = getFirestore();
  // Every push path (sync, push-all-seasons, new-season) comes through here
  // and push-seasons calls the same write, so the castaway id cutover gate
  // and the stored-logo rule hold for all of them.
  let refusal: string | null;
  try {
    refusal = await commitSeasonPush(db, seasonNum, castawayLookup, documents);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Firestore upload failed without applying the season update: ${message}`,
    );
  }
  if (refusal) {
    throw new Error(`Refusing to push ${seasonKey}: ${refusal}`);
  }
  console.log(`\nUploaded season ${seasonNum} data to Firestore:\n`);
  for (const doc of documents) {
    console.log(`  [OK] ${doc.collection}/${doc.docId}`);
  }
  console.log(
    `  [OK] img: ${seasonDoc.img ? `"${seasonDoc.img}"` : "(none)"}, revisions: data ${seasonDoc.data_revision}, scoring ${seasonDoc.scoring_revision}`,
  );

  console.log(`\nFirestore upload complete.`);
}

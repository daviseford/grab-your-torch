/**
 * Push a bundled season's documents (the season document and its result
 * collections) to Firestore, for `scripts/push-seasons.ts`. Kept apart from
 * the script so the write path, including its castaway id remap gate, can be
 * tested against the emulator: the script initializes the Admin SDK on import.
 */

import type { Firestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { seasonPushGate } from "./remap-ledger.js";
import { buildSeasonDocument } from "./season-document.js";
import {
  readLocalSeasonImg,
  resolveSeasonImg,
  SEASONS_FILE_PATH,
} from "./season-img.js";

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
  {
    localSeasonImg = readLocalSeasonImg(
      fs.readFileSync(SEASONS_FILE_PATH, "utf-8"),
      seasonNum,
    ),
  }: { localSeasonImg?: string } = {},
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
        // An empty logo keeps the stored one; see commitSeasonPush.
        seasonImg: localSeasonImg,
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
  if (collections.has("seasons")) {
    console.log(`    img: ${describeSeasonImg(localSeasonImg)}`);
  }

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
    const paths = selectedDocs.map((doc) => `${doc.collection}/${seasonKey}`);
    try {
      const refusal = await commitSeasonPush(
        db!,
        seasonNum,
        castawayLookup,
        selectedDocs,
      );
      if (refusal) {
        console.error(`    [REFUSED] season ${seasonNum}: ${refusal}`);
        failed.push(...paths);
      } else {
        pushed.push(...paths);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    [FAIL] season ${seasonNum}: ${msg}`);
      failed.push(...paths);
    }
  }

  return { pushed, skipped, failed };
}

/** How a push will set `img`, for dry runs and logs. */
export function describeSeasonImg(seasonImg: string): string {
  return seasonImg
    ? `"${seasonImg}"`
    : "none given; the stored logo, if any, is kept";
}

/**
 * The one write every season push route makes (push-seasons, and through
 * pushSeasonToFirestore the nightly sync, push-all-seasons and the new-season
 * scripts). Returns the gate's refusal without reading or writing anything,
 * or null once the batch committed; a failed commit throws.
 *
 * The gate comes first: result collections carry castaway ids too, so no
 * route may push them mid-cutover or from the wrong side of a remap. Then,
 * because `set` replaces the season document whole, a season document
 * without a logo takes the stored one instead of deleting it. A logo the
 * caller gives is an intentional value and is written as is.
 */
export async function commitSeasonPush(
  db: Firestore,
  seasonNum: number,
  castawayLookup: unknown,
  docs: readonly { collection: string; data: Record<string, unknown> }[],
): Promise<string | null> {
  const seasonKey = `season_${seasonNum}`;
  const refusal = await seasonPushGate(db, seasonNum, castawayLookup);
  if (refusal) return refusal;

  const seasonDoc = docs.find((doc) => doc.collection === "seasons");
  if (seasonDoc && !seasonDoc.data.img) {
    const stored = await db.collection("seasons").doc(seasonKey).get();
    seasonDoc.data.img = resolveSeasonImg("", stored.get("img"));
  }

  const batch = db.batch();
  for (const doc of docs) {
    batch.set(db.collection(doc.collection).doc(seasonKey), doc.data);
  }
  await batch.commit();
  return null;
}

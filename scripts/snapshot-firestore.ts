/**
 * Snapshot all season data from Firestore + RTDB drafts to local JSON.
 * Serves as both a comparison baseline and pre-migration backup.
 *
 * Usage: npx tsx scripts/snapshot-firestore.ts [season_numbers...]
 *
 * Examples:
 *   npx tsx scripts/snapshot-firestore.ts           # all seasons + all drafts
 *   npx tsx scripts/snapshot-firestore.ts 46 48 50  # specific seasons + all drafts
 *
 * READ-ONLY — never writes to Firestore or RTDB.
 */

import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

const COLLECTIONS = [
  "seasons",
  "challenges",
  "eliminations",
  "events",
  "vote_history",
] as const;

/* ------------------------------------------------------------------ *
 * A minimal read-only view of Firestore
 *
 * The Admin SDK types satisfy these structurally, so `snapshotPools` can
 * take a real Firestore instance in production and a plain fixture object
 * in tests. Nothing here can write: there is no `set`, `update`, or
 * `delete` anywhere in the interface.
 * ------------------------------------------------------------------ */

export type ReadableDoc = {
  id: string;
  exists: boolean;
  data(): unknown;
};

export type ReadableDocRef = {
  get(): Promise<ReadableDoc>;
  collection(collectionPath: string): ReadableCollectionRef;
};

export type ReadableCollectionRef = {
  get(): Promise<{ docs: ReadableDoc[] }>;
  doc(documentPath: string): ReadableDocRef;
};

export type ReadableDb = {
  collection(collectionPath: string): ReadableCollectionRef;
};

/** The shape a test fixture tree uses: `__data` is the document body. */
export type ReadableNode = {
  __data?: Record<string, unknown>;
  [child: string]: unknown;
};

/* ------------------------------------------------------------------ *
 * The pool walk
 * ------------------------------------------------------------------ */

/**
 * Where a pool lands inside a snapshot directory.
 *
 * Exported because `scripts/repair-pool-picks.ts` reads snapshots back:
 * auditing a backup is the one way to check stored picks without touching
 * production, so the writer and the reader must agree on the layout.
 */
export const POOL_SNAPSHOT_DIR = "pools";

export const POOL_SNAPSHOT_FILES = {
  config: "config.json",
  counters: "counters.json",
  entries: "entries.json",
  standings: "standings.json",
} as const;

export type PoolSnapshotSummary = {
  pool_id: string;
  entries: number;
  standings: number;
  standings_pages: number;
};

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const docsById = (docs: ReadableDoc[]): Record<string, unknown> =>
  Object.fromEntries(docs.map((doc) => [doc.id, doc.data()]));

/**
 * Back up every pool, including its subcollections.
 *
 * Deliberately not an entry in `COLLECTIONS`: that loop fetches exactly one
 * document per collection keyed by season, so it would capture a single
 * config document and silently miss every entry. Pool entries are the first
 * user-authored data in this system with no regenerable upstream. Seasons
 * come from survivoR and competitions are already snapshotted, but an entry
 * exists nowhere else, so losing one loses somebody's picks for good (R24).
 */
export async function snapshotPools(
  db: ReadableDb,
  outDir: string,
): Promise<PoolSnapshotSummary[]> {
  const poolsCollection = db.collection("pools");
  const poolDocs = (await poolsCollection.get()).docs.filter((d) => d.exists);

  const summaries: PoolSnapshotSummary[] = [];

  for (const poolDoc of poolDocs) {
    const poolRef = poolsCollection.doc(poolDoc.id);
    const poolDir = path.join(outDir, POOL_SNAPSHOT_DIR, poolDoc.id);
    fs.mkdirSync(poolDir, { recursive: true });

    writeJson(path.join(poolDir, POOL_SNAPSHOT_FILES.config), poolDoc.data());

    const counters = await poolRef.collection("meta").doc("counters").get();
    writeJson(
      path.join(poolDir, POOL_SNAPSHOT_FILES.counters),
      counters.exists ? counters.data() : null,
    );

    const entries = (await poolRef.collection("entries").get()).docs.filter(
      (d) => d.exists,
    );
    writeJson(
      path.join(poolDir, POOL_SNAPSHOT_FILES.entries),
      docsById(entries),
    );

    // Overflow pages hold every row past the summary document's top slice, so
    // a standings backup that stopped at the summary would drop most entrants.
    const standingsCollection = poolRef.collection("standings");
    const standingsDocs = (await standingsCollection.get()).docs.filter(
      (d) => d.exists,
    );
    const standings: Record<string, unknown> = {};
    let pageCount = 0;

    for (const standingsDoc of standingsDocs) {
      const pages = (
        await standingsCollection.doc(standingsDoc.id).collection("pages").get()
      ).docs.filter((d) => d.exists);
      pageCount += pages.length;
      standings[standingsDoc.id] = {
        doc: standingsDoc.data(),
        pages: docsById(pages),
      };
    }

    writeJson(path.join(poolDir, POOL_SNAPSHOT_FILES.standings), standings);

    summaries.push({
      pool_id: poolDoc.id,
      entries: entries.length,
      standings: standingsDocs.length,
      standings_pages: pageCount,
    });
  }

  return summaries;
}

/* ------------------------------------------------------------------ *
 * Season walk
 * ------------------------------------------------------------------ */

async function snapshotSeason(
  db: FirebaseFirestore.Firestore,
  seasonNum: number,
  outDir: string,
): Promise<void> {
  const seasonKey = `season_${seasonNum}`;
  const seasonDir = path.join(outDir, seasonKey);

  fs.mkdirSync(seasonDir, { recursive: true });

  for (const collection of COLLECTIONS) {
    const doc = await db.collection(collection).doc(seasonKey).get();
    const data = doc.exists ? doc.data() : null;
    writeJson(path.join(seasonDir, `${collection}.json`), data);

    let status: string;
    if (!data) {
      status = "missing";
    } else if (collection === "seasons") {
      status = "exists";
    } else {
      status = String(Object.keys(data).length);
    }
    console.log(`  ${seasonKey}/${collection}: ${status}`);
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  // Trigger Firebase Admin init (read-only usage). Deferred to here rather
  // than a top-level import so that importing this module for its pure
  // helpers, as the tests do, never initializes the SDK.
  await import("./lib/admin.js");

  const db = getFirestore();
  const args = process.argv.slice(2).map(Number).filter(Boolean);

  // If no args, discover all seasons from the seasons collection
  let seasonNums: number[];
  if (args.length > 0) {
    seasonNums = args;
  } else {
    const snapshot = await db.collection("seasons").get();
    seasonNums = snapshot.docs
      .map((doc) => {
        const match = doc.id.match(/^season_(\d+)$/);
        return match ? Number(match[1]) : 0;
      })
      .filter(Boolean)
      .sort((a, b) => a - b);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join("data", "firestore-snapshots", timestamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Snapshotting ${seasonNums.length} seasons to ${outDir}/\n`);

  for (const num of seasonNums) {
    await snapshotSeason(db, num, outDir);
  }

  // Snapshot RTDB drafts
  console.log("\n  Snapshotting RTDB drafts...");
  const rtdb = getDatabase();
  const draftsSnapshot = await rtdb.ref("drafts").once("value");
  const draftsData = draftsSnapshot.val();
  const draftCount = draftsData ? Object.keys(draftsData).length : 0;
  writeJson(path.join(outDir, "rtdb_drafts.json"), draftsData);
  console.log(`  rtdb/drafts: ${draftCount} drafts`);

  // Snapshot competitions from Firestore
  console.log("\n  Snapshotting competitions...");
  const competitionsSnap = await db.collection("competitions").get();
  const competitions = Object.fromEntries(
    competitionsSnap.docs.map((doc) => [doc.id, doc.data()]),
  );
  writeJson(path.join(outDir, "competitions.json"), competitions);
  console.log(`  competitions: ${competitionsSnap.docs.length}`);

  // Snapshot pools, including entries, counters, and standings pages
  console.log("\n  Snapshotting pools...");
  const poolSummaries = await snapshotPools(db, outDir);
  if (poolSummaries.length === 0) {
    console.log("  pools: none");
  }
  for (const summary of poolSummaries) {
    console.log(
      `  pools/${summary.pool_id}: ${summary.entries} entries, ` +
        `${summary.standings} standings, ${summary.standings_pages} pages`,
    );
  }

  // Write a manifest
  const manifest = {
    snapshotAt: new Date().toISOString(),
    seasons: seasonNums,
    collections: [...COLLECTIONS],
    extras: ["rtdb_drafts", "competitions", "pools"],
    pools: poolSummaries,
  };
  writeJson(path.join(outDir, "manifest.json"), manifest);

  console.log(`\nSnapshot complete: ${outDir}/`);
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Snapshot failed:", err);
      process.exit(1);
    });
}

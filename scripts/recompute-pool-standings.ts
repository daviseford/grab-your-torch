/**
 * Recompute and publish the public season pool leaderboard.
 *
 * Standings are a cache, never a stored score of record (KTD5): every run
 * rebuilds every episode from one upward out of the season result data, and
 * rewrites the documents wholesale rather than patching them. A correction to
 * an earlier episode invalidates every later one, so there is no incremental
 * mode and there never should be.
 *
 * The published documents are still never deleted (KTD8). The signed-out read
 * path has no recompute fallback, so a missing standings document takes the
 * public leaderboard down until the next run; stale is not the same as
 * missing, and the stamp on each document is what lets a reader tell.
 *
 * Pure planning lives in `lib/pool-standings-recompute.ts`: `planRecompute`
 * takes data and returns documents, with no database in its signature. The Admin SDK is
 * imported dynamically inside the write branch only, so the test import graph
 * never reaches `scripts/lib/admin.ts` and a dry run over a fixture never
 * loads a credential.
 *
 * Dry run by default. Nothing is written unless `--write` is passed.
 *
 * Usage:
 *   yarn recompute-pool-standings 51                      # dry run, live read
 *   yarn recompute-pool-standings pool_season_51          # same, by pool id
 *   yarn recompute-pool-standings 51 --fixture f.json     # dry run, no Firebase
 *   yarn recompute-pool-standings 51 --write              # publish
 *   yarn recompute-pool-standings 51 --write --force      # allow a shrinking field
 */

import * as fs from "fs";
import { SCORING_REVISION } from "../src/data/scoringRevision.generated";
import type {
  Challenge,
  Elimination,
  GameEvent,
  PoolPick,
  Season,
} from "../src/types";
import { describeAudit } from "./repair-pool-picks.js";
import type {
  ReadableCollectionRef,
  ReadableDb,
  ReadableNode,
} from "./snapshot-firestore.js";

import {
  buildJobMetrics,
  buildJobSummary,
  buildStandingsWrites,
  ExistingStandings,
  planRecompute,
  RecomputeEntry,
  RecomputeInput,
  RecomputePlan,
  RecomputeRefusal,
  standingsByteSize,
  StandingsWrite,
  StandingsWriter,
} from "./lib/pool-standings-recompute.js";
export * from "./lib/pool-standings-recompute.js";

/** Apply writes strictly in order, stopping at the first failure. */
export const applyStandingsWrites = async (
  writer: StandingsWriter,
  writes: readonly StandingsWrite[],
): Promise<void> => {
  for (const write of writes) {
    if (write.op === "set") await writer.set(write.path, write.data);
    else await writer.update(write.path, write.data);
  }
};

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

const docsOf = async (
  collection: ReadableCollectionRef,
): Promise<{ id: string; data: Record<string, unknown> }[]> =>
  (await collection.get()).docs
    .filter((doc) => doc.exists)
    .map((doc) => ({
      id: doc.id,
      data: (doc.data() ?? {}) as Record<string, unknown>,
    }));

const valuesOf = <T>(data: unknown): T[] =>
  data && typeof data === "object"
    ? (Object.values(data as Record<string, T>) as T[])
    : [];

const toRecomputeEntry = (
  id: string,
  data: Record<string, unknown>,
): RecomputeEntry => ({
  uid: id,
  handle: typeof data.handle === "string" ? data.handle : "",
  picks: Array.isArray(data.picks) ? (data.picks as PoolPick[]) : [],
  prop_bets: data.prop_bets,
});

const toExistingStandings = (
  id: string,
  data: Record<string, unknown>,
): ExistingStandings => ({
  episode_num:
    typeof data.episode_num === "number"
      ? data.episode_num
      : Number(id.replace("episode_", "")),
  entry_count: typeof data.entry_count === "number" ? data.entry_count : 0,
  freeze_at: data.freeze_at,
});

export type LoadedRecomputeInputs = Omit<RecomputeInput, "computedAt">;

/**
 * Every read the job performs, all of them here and all of them once.
 *
 * Seven reads whatever the episode count and whatever the entrant count: the
 * config, the entries collection, the published standings, the season
 * document, and the three result documents. The result collections hold one
 * document per season, so that side is three reads however large the season
 * gets.
 *
 * Read-only: `ReadableDb` has no `set`, `update` or `delete` anywhere in it.
 */
export const loadPoolStandingsInputs = async (
  db: ReadableDb,
  poolId: string,
): Promise<LoadedRecomputeInputs> => {
  const poolRef = db.collection("pools").doc(poolId);
  const poolDoc = await poolRef.get();

  if (!poolDoc.exists) {
    throw new Error(`No pool configuration document at pools/${poolId}.`);
  }
  const pool = poolDoc.data() as RecomputeInput["pool"];

  const entries = (await docsOf(poolRef.collection("entries"))).map((doc) =>
    toRecomputeEntry(doc.id, doc.data),
  );

  const existingStandings = (await docsOf(poolRef.collection("standings"))).map(
    (doc) => toExistingStandings(doc.id, doc.data),
  );

  const seasonId = pool.season_id as Season["id"];
  const seasonDoc = await db.collection("seasons").doc(seasonId).get();
  const season = (seasonDoc.exists ? seasonDoc.data() : {}) as Partial<Season>;

  const readResults = async <T>(collection: string): Promise<T[]> => {
    const doc = await db.collection(collection).doc(seasonId).get();
    return doc.exists ? valuesOf<T>(doc.data()) : [];
  };

  const challenges = await readResults<Challenge>("challenges");
  const eliminations = await readResults<Elimination>("eliminations");
  const events = await readResults<GameEvent>("events");

  return {
    pool,
    entries,
    data: {
      episodes: Array.isArray(season.episodes) ? season.episodes : [],
      challenges,
      eliminations,
      events,
    },
    revisions: {
      data_revision: season.data_revision ?? "",
      scoring_revision: SCORING_REVISION,
      season_scoring_revision: season.scoring_revision,
    },
    existingStandings,
  };
};

/* ------------------------------------------------------------------ *
 * A fixture database
 *
 * The job cannot be run end to end against real data yet, by design: Season
 * 51 has no season document in Firestore. So the fixture is the proof. This
 * builds a read-only view over a plain JSON tree in the same shape a
 * `snapshot-firestore` backup walks, and it is the exact code path the read
 * accounting in the tests measures.
 * ------------------------------------------------------------------ */

const asNode = (value: unknown): ReadableNode =>
  (value ?? {}) as unknown as ReadableNode;

export const createFixtureDb = (
  tree: ReadableNode,
  onRead: (path: string) => void = () => {},
): ReadableDb => {
  const collectionRef = (
    parent: ReadableNode,
    name: string,
    path: string,
  ): ReadableCollectionRef => ({
    async get() {
      onRead(path);
      const children = asNode(parent[name]);
      return {
        docs: Object.keys(children).map((docId) => ({
          id: docId,
          exists: true,
          data: () => asNode(children[docId]).__data ?? {},
        })),
      };
    },
    doc(docId: string) {
      const children = asNode(parent[name]);
      const docPath = `${path}/${docId}`;
      return {
        async get() {
          onRead(docPath);
          const child = children[docId] as ReadableNode | undefined;
          return {
            id: docId,
            exists: child !== undefined,
            data: () => asNode(child).__data ?? {},
          };
        },
        collection(childName: string) {
          return collectionRef(
            asNode(children[docId]),
            childName,
            `${docPath}/${childName}`,
          );
        },
      };
    },
  });

  return { collection: (name) => collectionRef(tree, name, name) };
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export const poolIdFromArg = (arg: string): string =>
  /^\d+$/.test(arg) ? `pool_season_${arg}` : arg;

export type Args = {
  poolId: string | null;
  write: boolean;
  force: boolean;
  fixture: string | null;
  resultFile: string | null;
};

export const parseArgs = (argv: readonly string[]): Args => {
  const parsed: Args = {
    poolId: null,
    write: false,
    force: false,
    fixture: null,
    resultFile: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--dry-run") parsed.write = false;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--fixture") {
      i += 1;
      parsed.fixture = argv[i] ?? null;
    } else if (arg === "--result") {
      i += 1;
      parsed.resultFile = argv[i] ?? null;
    } else if (!arg.startsWith("--")) {
      parsed.poolId = poolIdFromArg(arg);
    }
  }

  return parsed;
};

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

const emitSummary = (
  summary: string,
  resultFile: string | null,
  metrics: unknown,
) => {
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    fs.appendFileSync(stepSummary, `${summary}\n`);
  } else {
    console.log("");
    console.log(summary);
  }
  if (resultFile) {
    fs.writeFileSync(resultFile, JSON.stringify(metrics, null, 2));
    console.log(`Metrics written to ${resultFile}.`);
  }
};

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { poolId, write, force, fixture, resultFile } = parseArgs(
    process.argv.slice(2),
  );

  if (poolId === null) {
    fail(
      "no pool given. Usage: yarn recompute-pool-standings <season|poolId> [--fixture <file>] [--write] [--force]",
    );
    return;
  }

  // On a runner, stdout and stderr are the workflow log, and this repository
  // is public. Anything naming an entrant is withheld there.
  const isPublicLog = Boolean(process.env.GITHUB_ACTIONS || process.env.CI);

  if (fixture && write) {
    fail(
      "--fixture and --write cannot be combined. A fixture is a local file, not the live pool",
    );
    return;
  }

  let db: ReadableDb;

  if (fixture) {
    console.log(`Recomputing ${poolId} from the fixture at ${fixture}.`);
    db = createFixtureDb(
      JSON.parse(fs.readFileSync(fixture, "utf-8")) as ReadableNode,
    );
  } else {
    // The Admin SDK is loaded only when Firebase is actually needed:
    // importing it initializes the app and requires firebase-private-key.json.
    const { adminApp } = await import("./lib/admin.js");
    const { getFirestore } = await import("firebase-admin/firestore");
    console.log(`Firebase project: ${adminApp.options.projectId}`);
    console.log(`Recomputing ${poolId}.`);
    db = getFirestore() as unknown as ReadableDb;
  }

  const loaded = await loadPoolStandingsInputs(db, poolId);

  if (
    loaded.revisions.season_scoring_revision &&
    loaded.revisions.season_scoring_revision !== SCORING_REVISION
  ) {
    console.warn(
      `Warning: season data was written with scoring revision ` +
        `${loaded.revisions.season_scoring_revision}, this job is ` +
        `${SCORING_REVISION}. The published stamp records this job's.`,
    );
  }

  let plan: RecomputePlan;
  try {
    plan = planRecompute({
      ...loaded,
      force,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof RecomputeRefusal) {
      console.error("");
      console.error(`Refusing to publish (${err.code}): ${err.message}.`);
      if (isPublicLog) {
        console.error(
          "  Entry details withheld: this log is public. Re-run locally, or",
        );
        console.error(
          `  run "yarn repair-pool-picks ${poolId}" to see and fix them.`,
        );
      } else {
        for (const line of err.details) console.error(line);
      }
      process.exit(1);
    }
    throw err;
  }

  // The audit names entrants by uid, so where it goes depends on who can read
  // it. On a runner this is the workflow log of a public repository, which
  // would publish before the freeze exactly what R19 hides and after it
  // exactly what R17 bans. An operator running locally needs the ids to fix
  // the picks, and gets them.
  if (!plan.audit.ok) {
    console.log("");
    if (isPublicLog) {
      console.log(
        `Pick audit: ${plan.audit.mismatches.length} repairable, ` +
          `${plan.audit.unrepairable.length} unrepairable. Entry details ` +
          `withheld from this public log.`,
      );
    } else {
      for (const line of describeAudit(plan.audit)) console.log(line);
    }
  }

  const writes = buildStandingsWrites(poolId, plan);
  const summary = buildJobSummary(poolId, plan, Date.now() - startedAt);

  if (plan.status !== "ok") {
    console.log("");
    console.log(`Nothing to publish: ${plan.reason}.`);
    emitSummary(
      summary,
      resultFile,
      buildJobMetrics(poolId, plan, Date.now() - startedAt),
    );
    return;
  }

  console.log("");
  console.log(`  Entrants:        ${plan.entry_count}`);
  console.log(`  Episodes:        ${plan.episodes.length}`);
  console.log(`  Newest episode:  ${plan.latest_episode_num}`);
  console.log(`  Season complete: ${plan.season_complete}`);
  console.log(`  Standings bytes: ${standingsByteSize(plan)}`);
  console.log("");
  console.log("Writes, in order:");
  for (const item of writes) {
    console.log(`  ${item.op.padEnd(6)} ${item.path}`);
  }

  if (!write) {
    console.log("");
    console.log("Top of the newest leaderboard:");
    for (const row of plan.episodes.at(-1)!.summary.rows.slice(0, 10)) {
      console.log(
        `  ${String(row.rank).padStart(3)}. ${row.handle.padEnd(24)} ` +
          `${row.total} (prop bets ${row.prop_bet_points})`,
      );
    }
    console.log("");
    console.log(
      "[DRY RUN] Nothing was written. Re-run with --write to publish.",
    );
    emitSummary(
      summary,
      resultFile,
      buildJobMetrics(poolId, plan, Date.now() - startedAt),
    );
    return;
  }

  const { getFirestore } = await import("firebase-admin/firestore");
  const store = getFirestore();
  const writer: StandingsWriter = {
    set: async (path, data) => {
      await store.doc(path).set(data as Record<string, unknown>);
    },
    update: async (path, data) => {
      await store.doc(path).update(data as Record<string, unknown>);
    },
  };

  await applyStandingsWrites(writer, writes);

  console.log("");
  console.log(
    `Published ${plan.episodes.length} standings document(s); ` +
      `latest_episode_num is now ${plan.latest_episode_num}.`,
  );
  emitSummary(
    summary,
    resultFile,
    buildJobMetrics(poolId, plan, Date.now() - startedAt),
  );
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Standings recompute failed:", err);
      process.exit(1);
    });
}

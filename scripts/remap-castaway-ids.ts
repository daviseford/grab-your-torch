/**
 * Remap a season's stored castaway ids from the app's committed (provisional)
 * ids to survivoR's published ids.
 *
 * Built for Season 51, whose cast was bootstrapped from the wiki with
 * predicted ids before survivoR published, and whose drafts, competitions,
 * trades and pool entries were all saved on those ids. survivoR's ids came
 * out as a permutation of the same range, so this is a one-lookup,
 * apply-at-most-once remap; see `scripts/lib/castaway-id-remap.ts` and
 * `docs/castaway-id-mapping.md`.
 *
 * Three modes:
 *
 *   dry run (default)  Reads survivoR at a pinned commit, the committed season
 *                      file, and production (read-only). Writes a plan file
 *                      that is also the field-level backup (every change
 *                      carries `before` and `after`). Prints counts only.
 *   --write            Applies a reviewed plan file. Each document is
 *                      compare-and-set against the plan's `before`, so a
 *                      document that moved on is skipped as stale, and each
 *                      applied path is recorded in a ledger document so a
 *                      rerun never remaps it twice.
 *   --rollback         Restores `before` wherever a document still holds the
 *                      plan's `after`, and clears those ledger entries.
 *
 * Writes need `--plan <file>` and `--project <id>` naming the project the
 * service account belongs to. Derived data is not remapped here: rerun
 * `yarn recompute-castaway-adp <season> --write` afterwards, from a checkout
 * whose season file carries survivoR's ids.
 *
 * Usage:
 *   yarn remap-castaway-ids 51
 *   yarn remap-castaway-ids 51 --upstream <survivoR commit sha>
 *   yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b
 *   yarn remap-castaway-ids 51 --rollback --plan <file> --project survivor-fantasy-51c4b
 *
 * The Admin SDK key defaults to `firebase-private-key.json` in the project
 * root; `FIREBASE_PRIVATE_KEY_PATH` overrides it (useful from a worktree).
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { CastawayLookup } from "../src/types";
import {
  applyCastawayIdRemap,
  type CastawayIdMappingPlan,
  planCastawayIdMapping,
  planDocumentRemap,
  type RemapDocChange,
  type RemapDocKind,
  type RemapDocumentPlan,
  type RemapSourceDoc,
  type RemapStore,
  rollbackCastawayIdRemap,
  type UpstreamCastaway,
} from "./lib/castaway-id-remap.js";

/** survivoR commit that first published Season 51 (reviewed 2026-09-26). */
export const DEFAULT_UPSTREAM_COMMIT =
  "7336413e39c34c31231b9fa17281a47f731837e0";

const LEDGER_COLLECTION = "admin_migrations";
const ledgerDocId = (seasonNum: number) =>
  `castaway_id_remap_season_${seasonNum}`;

const PLAN_DIR = path.join("data", "migration-output", "castaway-id-remap");

/** Per-season collections keyed by season id; inventoried, not remapped. */
const SEASON_DOC_COLLECTIONS = [
  "seasons",
  "challenges",
  "eliminations",
  "events",
  "vote_history",
  "teams",
  "team_assignments",
] as const;

export type RemapPlanFile = {
  season_num: number;
  created_at: string;
  project_id: string | null;
  upstream: { repo: "doehm/survivoR"; commit: string; tables: string[] };
  mapping: CastawayIdMappingPlan;
  inventory: Record<string, number | boolean>;
  documents: RemapDocumentPlan;
};

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

type RawCastaway = {
  version?: string;
  season?: number;
  castaway_id: string;
  full_name: string;
  castaway: string;
};

async function fetchUpstreamTable<T>(commit: string, table: string) {
  const url = `https://raw.githubusercontent.com/doehm/survivoR/${commit}/dev/json/${table}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.json()) as T[];
}

export async function loadUpstreamCast(
  commit: string,
  seasonNum: number,
): Promise<UpstreamCastaway[]> {
  const [castaways, details] = await Promise.all([
    fetchUpstreamTable<RawCastaway>(commit, "castaways"),
    fetchUpstreamTable<RawCastaway>(commit, "castaway_details"),
  ]);
  const detailName = new Map(details.map((d) => [d.castaway_id, d.full_name]));
  const seen = new Set<string>();
  const out: UpstreamCastaway[] = [];
  for (const c of castaways) {
    if (c.version !== "US" || Math.round(c.season ?? 0) !== seasonNum) continue;
    if (seen.has(c.castaway_id)) continue;
    seen.add(c.castaway_id);
    out.push({
      castaway_id: c.castaway_id,
      full_name: c.full_name,
      castaway: c.castaway,
      details_full_name: detailName.get(c.castaway_id),
    });
  }
  return out;
}

async function loadCommittedLookup(seasonNum: number): Promise<CastawayLookup> {
  const mod = (await import(
    `../src/data/season_${seasonNum}/index.ts`
  )) as Record<string, unknown>;
  const lookup = mod[`SEASON_${seasonNum}_CASTAWAY_LOOKUP`];
  if (!lookup) throw new Error(`No SEASON_${seasonNum}_CASTAWAY_LOOKUP export`);
  return lookup as CastawayLookup;
}

async function castawayPropBetKeys(): Promise<Set<string>> {
  const { PropBetsQuestions } = await import("../src/data/propbets.js");
  return new Set(
    Object.entries(PropBetsQuestions)
      .filter(([, q]) => q.answer_type === "castaway")
      .map(([key]) => key),
  );
}

/* ------------------------------------------------------------------ *
 * Firebase adapters
 * ------------------------------------------------------------------ */

type Admin = {
  projectId: string | null;
  firestore: import("firebase-admin/firestore").Firestore;
  rtdb: import("firebase-admin/database").Database;
};

async function loadAdmin(): Promise<Admin> {
  const { adminApp } = await import("./lib/admin.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getDatabase } = await import("firebase-admin/database");
  return {
    projectId: adminApp.options.projectId ?? null,
    firestore: getFirestore(),
    rtdb: getDatabase(),
  };
}

const plain = (v: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(v ?? {}));

async function readProduction(
  { firestore, rtdb }: Admin,
  seasonNum: number,
): Promise<{
  docs: RemapSourceDoc[];
  inventory: Record<string, number | boolean>;
  appliedPaths: Set<string>;
}> {
  const seasonId = `season_${seasonNum}`;
  const poolId = `pool_season_${seasonNum}`;
  const docs: RemapSourceDoc[] = [];
  const inventory: Record<string, number | boolean> = {};

  const competitions = await firestore
    .collection("competitions")
    .where("season_id", "==", seasonId)
    .get();
  inventory.competitions = competitions.size;
  let tradeCount = 0;
  for (const comp of competitions.docs) {
    docs.push({
      kind: "competition",
      path: `competitions/${comp.id}`,
      data: plain(comp.data()),
    });
    const trades = await comp.ref.collection("trades").get();
    tradeCount += trades.size;
    for (const t of trades.docs) {
      docs.push({
        kind: "trade",
        path: `competitions/${comp.id}/trades/${t.id}`,
        data: plain(t.data()),
      });
    }
  }
  inventory.trades = tradeCount;

  const drafts = await rtdb
    .ref("drafts")
    .orderByChild("season_id")
    .equalTo(seasonId)
    .once("value");
  let draftCount = 0;
  drafts.forEach((child) => {
    draftCount++;
    docs.push({
      kind: "rtdb_draft",
      path: `drafts/${child.key}`,
      data: plain(child.val()),
    });
  });
  inventory.rtdb_drafts = draftCount;

  const pool = await firestore.collection("pools").doc(poolId).get();
  inventory.pool_config = pool.exists;
  if (pool.exists) {
    docs.push({
      kind: "pool_config",
      path: `pools/${poolId}`,
      data: plain(pool.data()),
    });
    const entries = await pool.ref.collection("entries").get();
    inventory.pool_entries = entries.size;
    for (const e of entries.docs) {
      docs.push({
        kind: "pool_entry",
        path: `pools/${poolId}/entries/${e.id}`,
        data: plain(e.data()),
      });
    }
  }

  for (const collection of SEASON_DOC_COLLECTIONS) {
    const doc = await firestore.collection(collection).doc(seasonId).get();
    inventory[`${collection}/${seasonId}`] = doc.exists;
  }
  const adp = await firestore
    .collection("castaway_adp")
    .where("season_id", "==", seasonId)
    .get();
  inventory.castaway_adp_docs = adp.size;

  const ledger = await firestore
    .collection(LEDGER_COLLECTION)
    .doc(ledgerDocId(seasonNum))
    .get();
  const appliedPaths = new Set<string>(
    (ledger.data()?.applied_paths as string[] | undefined) ?? [],
  );
  inventory.ledger_applied_paths = appliedPaths.size;

  return { docs, inventory, appliedPaths };
}

const fieldsEqual = (
  current: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
) =>
  Object.entries(expected).every(
    ([k, v]) =>
      JSON.stringify(current?.[k] ?? null) === JSON.stringify(v ?? null),
  );

function productionStore(
  { firestore, rtdb }: Admin,
  seasonNum: number,
  meta: { mapping_hash: string; upstream_commit: string },
): RemapStore {
  const ledgerRef = firestore
    .collection(LEDGER_COLLECTION)
    .doc(ledgerDocId(seasonNum));
  return {
    async compareAndSet(kind: RemapDocKind, docPath, expected, next) {
      if (kind === "rtdb_draft") {
        const result = await rtdb.ref(docPath).transaction((current) => {
          // The first call usually sees null (nothing cached locally).
          // Returning null lets the server reject it and call back with the
          // real value; a node that is truly absent stays absent.
          if (current === null) return null;
          if (!fieldsEqual(plain(current), expected)) return; // abort
          return { ...current, ...next };
        });
        return (
          result.committed &&
          result.snapshot.exists() &&
          fieldsEqual(plain(result.snapshot.val()), next)
        );
      }
      return firestore.runTransaction(async (tx) => {
        const ref = firestore.doc(docPath);
        const snap = await tx.get(ref);
        if (!snap.exists || !fieldsEqual(plain(snap.data()), expected)) {
          return false;
        }
        tx.update(ref, next);
        return true;
      });
    },
    async setLedger(docPath, applied) {
      const { FieldValue } = await import("firebase-admin/firestore");
      await ledgerRef.set(
        {
          ...meta,
          updated_at: new Date().toISOString(),
          applied_paths: applied
            ? FieldValue.arrayUnion(docPath)
            : FieldValue.arrayRemove(docPath),
        },
        { merge: true },
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

type Args = {
  seasonNum: number | null;
  upstream: string;
  write: boolean;
  rollback: boolean;
  plan: string | null;
  project: string | null;
};

export function parseArgs(argv: readonly string[]): Args {
  const parsed: Args = {
    seasonNum: null,
    upstream: DEFAULT_UPSTREAM_COMMIT,
    write: false,
    rollback: false,
    plan: null,
    project: null,
  };
  const value = (i: number, flag: string) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--rollback") parsed.rollback = true;
    else if (arg === "--upstream") parsed.upstream = value(++i, arg);
    else if (arg === "--plan") parsed.plan = value(++i, arg);
    else if (arg === "--project") parsed.project = value(++i, arg);
    else if (/^\d+$/.test(arg)) parsed.seasonNum = Number(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]{40}$/.test(parsed.upstream)) {
    throw new Error("--upstream must be a full 40-character commit sha");
  }
  return parsed;
}

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

const countBy = (changes: readonly RemapDocChange[]) =>
  changes.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { seasonNum } = args;
  if (seasonNum === null) {
    return fail(
      "no season given. Usage: yarn remap-castaway-ids <season> [--upstream <sha>] [--write|--rollback --plan <file> --project <id>]",
    );
  }
  if (args.write && args.rollback) fail("--write and --rollback are exclusive");

  if (args.write || args.rollback) {
    if (!args.plan) fail("writes need --plan <file> from a reviewed dry run");
    if (!args.project) fail("writes need --project <id>");
    const plan = JSON.parse(
      fs.readFileSync(args.plan!, "utf-8"),
    ) as RemapPlanFile;
    if (plan.season_num !== seasonNum) fail("the plan is for another season");
    if (plan.mapping.errors.length > 0) fail("the plan's mapping has errors");
    if (plan.documents.problems.length > 0) {
      fail("the plan reports problems; resolve them and dry-run again");
    }
    const admin = await loadAdmin();
    if (admin.projectId !== args.project) {
      fail(
        `--project ${args.project} does not match the service account's project ${admin.projectId}`,
      );
    }
    const store = productionStore(admin, seasonNum, {
      mapping_hash: plan.mapping.mapping_hash,
      upstream_commit: plan.upstream.commit,
    });
    const run = args.write ? applyCastawayIdRemap : rollbackCastawayIdRemap;
    const result = await run(plan.documents.changes, store);
    console.log(
      `${args.write ? "Applied" : "Rolled back"} ${result.applied.length} of ${plan.documents.changes.length} documents; ${result.stale.length} stale.`,
    );
    for (const p of result.stale) console.log(`  stale: ${p}`);
    if (result.stale.length > 0) {
      console.log("Dry-run again to re-plan the stale documents.");
      process.exitCode = 1;
    }
    return;
  }

  console.log(`survivoR commit: ${args.upstream}`);
  const [upstream, lookup, propKeys] = await Promise.all([
    loadUpstreamCast(args.upstream, seasonNum),
    loadCommittedLookup(seasonNum),
    castawayPropBetKeys(),
  ]);
  const committed = Object.entries(lookup).map(([castaway_id, v]) => ({
    castaway_id,
    full_name: v.full_name,
    castaway: v.castaway,
  }));
  const mapping = planCastawayIdMapping(committed, upstream);

  console.log(
    `Mapping: ${mapping.mappings.length} castaways, ${mapping.changed.length} ids change, hash ${mapping.mapping_hash}`,
  );
  for (const m of mapping.mappings) {
    console.log(
      `  ${m.from} ${m.from === m.to ? "==" : "->"} ${m.to}  ${m.from_name}${m.from_name === m.to_name ? "" : ` (survivoR: ${m.to_name})`}  [${m.matched_by}]`,
    );
  }
  for (const e of mapping.errors) console.log(`  ERROR ${e}`);
  if (mapping.errors.length > 0) return fail("the mapping has errors");

  const admin = await loadAdmin();
  console.log(`\nFirebase project: ${admin.projectId} (read-only)`);
  const { docs, inventory, appliedPaths } = await readProduction(
    admin,
    seasonNum,
  );
  const documents = planDocumentRemap(docs, {
    mapping: mapping.mappings,
    castawayPropBetKeys: propKeys,
    appliedPaths,
  });

  console.log("Inventory:");
  for (const [k, v] of Object.entries(inventory)) console.log(`  ${k}: ${v}`);
  console.log(
    `Plan: ${documents.changes.length} documents to change ${JSON.stringify(countBy(documents.changes))}, ` +
      `${documents.changes.reduce((n, c) => n + c.id_changes, 0)} id values; ` +
      `${documents.unchanged.length} unchanged, ${documents.already_applied.length} already applied, ` +
      `${documents.problems.length} problems`,
  );
  const problemCounts = documents.problems.reduce<Record<string, number>>(
    (acc, p) => ((acc[p.reason] = (acc[p.reason] ?? 0) + 1), acc),
    {},
  );
  if (documents.problems.length > 0) {
    console.log(`Problems by reason: ${JSON.stringify(problemCounts)}`);
  }

  const file: RemapPlanFile = {
    season_num: seasonNum,
    created_at: new Date().toISOString(),
    project_id: admin.projectId,
    upstream: {
      repo: "doehm/survivoR",
      commit: args.upstream,
      tables: ["dev/json/castaways.json", "dev/json/castaway_details.json"],
    },
    mapping,
    inventory,
    documents,
  };
  fs.mkdirSync(PLAN_DIR, { recursive: true });
  const out = path.join(
    PLAN_DIR,
    `season_${seasonNum}-${file.created_at.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nPlan and field-level backup written to ${out} (gitignored).`);
  console.log("Nothing was written to Firebase.");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    // The Admin SDK keeps handles open; exit explicitly.
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((err) => {
      console.error("Castaway id remap failed:", err);
      process.exit(1);
    });
}

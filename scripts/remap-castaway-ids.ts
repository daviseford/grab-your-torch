/**
 * Remap a season's stored castaway ids from the app's provisional ids to
 * survivoR's published ids.
 *
 * Built for Season 51, whose cast was bootstrapped from the wiki with
 * predicted ids before survivoR published, and whose drafts, competitions,
 * trades, pool entries, season document and ADP summaries were all saved on
 * those ids. survivoR's ids came out as a permutation of the same range, so
 * this is a one-lookup, apply-at-most-once remap. See
 * `scripts/lib/castaway-id-remap.ts` and `docs/castaway-id-mapping.md`.
 *
 * Modes:
 *
 *   --generate-mapping  Once per season: match the committed provisional cast
 *                       to survivoR at a pinned commit and write the reviewed
 *                       mapping to scripts/castaway-id-remaps/season_N.json.
 *   (default) dry run   Verify the committed mapping (hash, and re-derived
 *                       from the pinned upstream), read production read-only,
 *                       and write a plan file that is also the field-level
 *                       backup. Prints counts only.
 *   --write             Apply a reviewed plan. Refuses unless the plan is for
 *                       this project and mapping, is fresh, a new read of
 *                       production plans exactly the same changes, it has no
 *                       problems, and no draft is live (or each live draft is
 *                       acknowledged). Each document is compare-and-set and
 *                       marked applied in the same transaction.
 *   --rollback          Restore a plan's `before` wherever its `after` is still
 *                       in place, clearing the applied marks. Newest plan first.
 *   --rewrite-season-file  Local only: rewrite src/data/season_N/index.ts
 *                       to survivoR's ids and names from the committed mapping,
 *                       adding no episode data. For the follow-up code PR.
 *
 * Usage:
 *   yarn remap-castaway-ids 51 --generate-mapping [--upstream <sha>]
 *   yarn remap-castaway-ids 51
 *   yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b [--ack-live-draft drafts/<id> ...]
 *   yarn remap-castaway-ids 51 --rollback --plan <file> --project survivor-fantasy-51c4b
 *   yarn remap-castaway-ids 51 --rewrite-season-file
 *
 * The Admin SDK key defaults to `firebase-private-key.json` in the project
 * root; `FIREBASE_PRIVATE_KEY_PATH` overrides it (useful from a worktree).
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { isDeepStrictEqual } from "util";
import type { CastawayLookup } from "../src/types";
import {
  applyCastawayIdRemap,
  type CastawayIdMappingFile,
  type CastState,
  classifyCommittedCast,
  type CommittedCastaway,
  fieldsEqual,
  planCastawayIdMapping,
  planDocumentRemap,
  type RemapDocChange,
  type RemapDocumentPlan,
  type RemapMark,
  type RemapSourceDoc,
  type RemapStore,
  rewriteSeasonSource,
  rollbackCastawayIdRemap,
  RTDB_REMAP_MARKER,
  type UpstreamCastaway,
  verifyMappingFile,
} from "./lib/castaway-id-remap.js";

/** survivoR commit that first published Season 51 (reviewed 2026-09-26). */
export const DEFAULT_UPSTREAM_COMMIT =
  "7336413e39c34c31231b9fa17281a47f731837e0";

export const REMAP_LEDGER_COLLECTION = "admin_migrations";
export const remapLedgerDocId = (seasonNum: number) =>
  `castaway_id_remap_season_${seasonNum}`;

const SCRIPTS_DIR = import.meta.dirname;
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, "..");
export const mappingFilePath = (seasonNum: number) =>
  path.join(SCRIPTS_DIR, "castaway-id-remaps", `season_${seasonNum}.json`);
const seasonFilePath = (seasonNum: number) =>
  path.join(PROJECT_ROOT, "src", "data", `season_${seasonNum}`, "index.ts");
const PLAN_DIR = path.join(
  PROJECT_ROOT,
  "data",
  "migration-output",
  "castaway-id-remap",
);

/** Per-season results keyed by castaway id: must be empty to remap. */
const SEASON_RESULT_COLLECTIONS = [
  "challenges",
  "eliminations",
  "events",
  "vote_history",
] as const;

const UPSTREAM_TABLES = [
  "dev/json/castaways.json",
  "dev/json/castaway_details.json",
];

export type RemapPlanFile = {
  season_num: number;
  created_at: string;
  project_id: string;
  mapping_hash: string;
  upstream_commit: string;
  local_season_file: CastState;
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

async function loadCommittedCast(
  seasonNum: number,
): Promise<CommittedCastaway[]> {
  const mod = (await import(
    pathToFileURL(seasonFilePath(seasonNum)).href
  )) as Record<string, unknown>;
  const lookup = mod[`SEASON_${seasonNum}_CASTAWAY_LOOKUP`] as
    | CastawayLookup
    | undefined;
  if (!lookup) throw new Error(`No SEASON_${seasonNum}_CASTAWAY_LOOKUP export`);
  return Object.entries(lookup).map(([castaway_id, v]) => ({
    castaway_id,
    full_name: v.full_name,
    castaway: v.castaway,
  }));
}

async function castawayPropBetKeys(): Promise<Set<string>> {
  const { PropBetsQuestions } = await import("../src/data/propbets.js");
  return new Set(
    Object.entries(PropBetsQuestions)
      .filter(([, q]) => q.answer_type === "castaway")
      .map(([key]) => key),
  );
}

export function readMappingFile(seasonNum: number): CastawayIdMappingFile {
  const file = mappingFilePath(seasonNum);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No committed mapping at ${file}. Run --generate-mapping, review, and commit it first.`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as CastawayIdMappingFile;
}

/** Verify the committed mapping, re-deriving it from its pinned upstream. */
async function verifiedMapping(
  seasonNum: number,
): Promise<CastawayIdMappingFile> {
  const file = readMappingFile(seasonNum);
  if (file.season_num !== seasonNum) {
    throw new Error("The committed mapping is for another season");
  }
  const upstream = await loadUpstreamCast(file.upstream.commit, seasonNum);
  const provisional = file.mappings.map((m) => ({
    castaway_id: m.from,
    full_name: m.from_name,
    castaway: "",
  }));
  const errors = verifyMappingFile(
    file,
    planCastawayIdMapping(provisional, upstream),
  );
  if (errors.length > 0) {
    throw new Error(`Mapping verification failed: ${errors.join("; ")}`);
  }
  return file;
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

/**
 * The minimal read surface `readProduction` needs, so tests can supply a
 * fake instead of Firebase.
 */
export type ProductionReader = {
  competitions(seasonId: string): Promise<{ id: string; data: unknown }[]>;
  trades(competitionId: string): Promise<{ id: string; data: unknown }[]>;
  drafts(seasonId: string): Promise<{ id: string; data: unknown }[]>;
  doc(docPath: string): Promise<unknown | null>;
  subcollection(docPath: string): Promise<{ id: string; data: unknown }[]>;
  adpDocs(seasonId: string): Promise<{ id: string; data: unknown }[]>;
};

export function firebaseReader({ firestore, rtdb }: Admin): ProductionReader {
  const rows = (snap: import("firebase-admin/firestore").QuerySnapshot) =>
    snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return {
    competitions: async (seasonId) =>
      rows(
        await firestore
          .collection("competitions")
          .where("season_id", "==", seasonId)
          .get(),
      ),
    trades: async (id) =>
      rows(await firestore.collection(`competitions/${id}/trades`).get()),
    drafts: async (seasonId) => {
      const snap = await rtdb
        .ref("drafts")
        .orderByChild("season_id")
        .equalTo(seasonId)
        .once("value");
      const out: { id: string; data: unknown }[] = [];
      snap.forEach((child) => {
        out.push({ id: child.key!, data: child.val() });
      });
      return out;
    },
    doc: async (docPath) => {
      const snap = await firestore.doc(docPath).get();
      return snap.exists ? snap.data() : null;
    },
    subcollection: async (docPath) =>
      rows(await firestore.collection(docPath).get()),
    adpDocs: async (seasonId) =>
      rows(
        await firestore
          .collection("castaway_adp")
          .where("season_id", "==", seasonId)
          .get(),
      ),
  };
}

export async function readProduction(
  reader: ProductionReader,
  seasonNum: number,
): Promise<{
  docs: RemapSourceDoc[];
  inventory: Record<string, number | boolean>;
  ledger: Map<string, string>;
  ledgerHash: string | null;
}> {
  const seasonId = `season_${seasonNum}`;
  const poolId = `pool_season_${seasonNum}`;
  const docs: RemapSourceDoc[] = [];
  const inventory: Record<string, number | boolean> = {};
  const push = (kind: RemapSourceDoc["kind"], p: string, data: unknown) =>
    docs.push({ kind, path: p, data: plain(data) });

  const competitions = await reader.competitions(seasonId);
  inventory.competitions = competitions.length;
  let tradeCount = 0;
  for (const comp of competitions) {
    push("competition", `competitions/${comp.id}`, comp.data);
    const trades = await reader.trades(comp.id);
    tradeCount += trades.length;
    for (const t of trades) {
      push("trade", `competitions/${comp.id}/trades/${t.id}`, t.data);
    }
  }
  inventory.trades = tradeCount;

  const drafts = await reader.drafts(seasonId);
  inventory.rtdb_drafts = drafts.length;
  for (const d of drafts) push("rtdb_draft", `drafts/${d.id}`, d.data);

  const pool = await reader.doc(`pools/${poolId}`);
  inventory.pool_config = pool !== null;
  if (pool !== null) {
    push("pool_config", `pools/${poolId}`, pool);
    const entries = await reader.subcollection(`pools/${poolId}/entries`);
    inventory.pool_entries = entries.length;
    for (const e of entries) {
      push("pool_entry", `pools/${poolId}/entries/${e.id}`, e.data);
    }
  }

  const season = await reader.doc(`seasons/${seasonId}`);
  inventory[`seasons/${seasonId}`] = season !== null;
  if (season !== null) push("season", `seasons/${seasonId}`, season);

  const teamAssignments = await reader.doc(`team_assignments/${seasonId}`);
  inventory[`team_assignments/${seasonId}`] = teamAssignments !== null;
  if (teamAssignments !== null) {
    push("team_assignments", `team_assignments/${seasonId}`, teamAssignments);
  }

  for (const collection of SEASON_RESULT_COLLECTIONS) {
    const doc = await reader.doc(`${collection}/${seasonId}`);
    inventory[`${collection}/${seasonId}`] = doc !== null;
    if (doc !== null) push("season_results", `${collection}/${seasonId}`, doc);
  }

  const adp = await reader.adpDocs(seasonId);
  inventory.castaway_adp_docs = adp.length;
  for (const a of adp) push("castaway_adp", `castaway_adp/${a.id}`, a.data);

  const ledgerDoc = plain(
    await reader.doc(
      `${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(seasonNum)}`,
    ),
  );
  const ledger = new Map<string, string>();
  const applied = ledgerDoc.applied;
  if (applied && typeof applied === "object") {
    for (const [p, v] of Object.entries(applied as Record<string, unknown>)) {
      const h = (v as { mapping_hash?: unknown })?.mapping_hash;
      if (typeof h === "string") ledger.set(p, h);
    }
  }
  inventory.ledger_applied_paths = ledger.size;
  inventory.rtdb_drafts_marked = drafts.filter(
    (d) => (d.data as Record<string, unknown> | null)?.[RTDB_REMAP_MARKER],
  ).length;
  return {
    docs,
    inventory,
    ledger,
    ledgerHash:
      typeof ledgerDoc.mapping_hash === "string"
        ? ledgerDoc.mapping_hash
        : null,
  };
}

/** Whether `mark` may be applied given the document's current mark hash. */
export const markAllows = (
  mark: RemapMark,
  current: string | undefined,
  hash: string,
): boolean => (mark === "set" ? current === undefined : current === hash);

function productionStore(
  { firestore, rtdb }: Admin,
  seasonNum: number,
  hash: string,
): RemapStore {
  const ledgerRef = firestore
    .collection(REMAP_LEDGER_COLLECTION)
    .doc(remapLedgerDocId(seasonNum));
  return {
    async compareAndSet(change, expected, next, mark) {
      const now = new Date().toISOString();
      if (change.kind === "rtdb_draft") {
        const result = await rtdb.ref(change.path).transaction((current) => {
          // The handler first runs against the local cache, which is empty
          // (null) for a node this process never read. Returning null asks
          // the server to store null; the server sees the real value differs,
          // rejects, and reruns this handler with it. If the node is truly
          // absent, null is committed (a no-op) and the check below reports
          // the document as stale rather than applied.
          if (current === null) return null;
          const node = plain(current);
          const markHash = (
            node[RTDB_REMAP_MARKER] as { mapping_hash?: string }
          )?.mapping_hash;
          if (
            !fieldsEqual(node, expected) ||
            !markAllows(mark, markHash, hash)
          ) {
            return; // abort: nothing written
          }
          const updated: Record<string, unknown> = { ...current, ...next };
          if (mark === "set") {
            updated[RTDB_REMAP_MARKER] = {
              mapping_hash: hash,
              applied_at: now,
            };
          } else if (mark === "clear") {
            delete updated[RTDB_REMAP_MARKER];
          }
          return updated;
        });
        if (!result.committed || !result.snapshot.exists()) return false;
        const stored = plain(result.snapshot.val());
        return fieldsEqual(stored, next);
      }
      const { FieldPath, FieldValue } =
        await import("firebase-admin/firestore");
      return firestore.runTransaction(async (tx) => {
        const ref = firestore.doc(change.path);
        const [snap, ledger] = await Promise.all([
          tx.get(ref),
          tx.get(ledgerRef),
        ]);
        if (!snap.exists || !ledger.exists) return false;
        const entry = (
          ledger.data()?.applied as
            | Record<string, { mapping_hash?: string }>
            | undefined
        )?.[change.path];
        if (
          !fieldsEqual(plain(snap.data()), expected) ||
          !markAllows(mark, entry?.mapping_hash, hash)
        ) {
          return false;
        }
        // Field paths, not dotted strings: team_assignments fields are
        // episode numbers, and no field name is parsed as a path.
        const [[firstKey, firstValue], ...rest] = Object.entries(next);
        tx.update(
          ref,
          new FieldPath(firstKey),
          firstValue,
          ...rest.flatMap(([k, v]) => [new FieldPath(k), v]),
        );
        if (mark !== "keep") {
          tx.update(
            ledgerRef,
            new FieldPath("applied", change.path),
            mark === "set"
              ? { mapping_hash: hash, applied_at: now, kind: change.kind }
              : FieldValue.delete(),
          );
        }
        return true;
      });
    },
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export type Args = {
  seasonNum: number | null;
  upstream: string;
  generateMapping: boolean;
  rewriteSeasonFile: boolean;
  write: boolean;
  rollback: boolean;
  plan: string | null;
  project: string | null;
  ackLiveDrafts: string[];
  maxPlanAgeHours: number;
};

export function parseArgs(argv: readonly string[]): Args {
  const parsed: Args = {
    seasonNum: null,
    upstream: DEFAULT_UPSTREAM_COMMIT,
    generateMapping: false,
    rewriteSeasonFile: false,
    write: false,
    rollback: false,
    plan: null,
    project: null,
    ackLiveDrafts: [],
    maxPlanAgeHours: 6,
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
    else if (arg === "--generate-mapping") parsed.generateMapping = true;
    else if (arg === "--rewrite-season-file") parsed.rewriteSeasonFile = true;
    else if (arg === "--upstream") parsed.upstream = value(++i, arg);
    else if (arg === "--plan") parsed.plan = value(++i, arg);
    else if (arg === "--project") parsed.project = value(++i, arg);
    else if (arg === "--ack-live-draft") {
      parsed.ackLiveDrafts.push(value(++i, arg));
    } else if (arg === "--max-plan-age-hours") {
      parsed.maxPlanAgeHours = Number(value(++i, arg));
      if (!(parsed.maxPlanAgeHours > 0)) {
        throw new Error("--max-plan-age-hours must be a positive number");
      }
    } else if (/^\d+$/.test(arg)) parsed.seasonNum = Number(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]{40}$/.test(parsed.upstream)) {
    throw new Error("--upstream must be a full 40-character commit sha");
  }
  const modes = [
    parsed.write,
    parsed.rollback,
    parsed.generateMapping,
    parsed.rewriteSeasonFile,
  ].filter(Boolean).length;
  if (modes > 1) {
    throw new Error(
      "--write, --rollback, --generate-mapping and --rewrite-season-file are exclusive",
    );
  }
  if ((parsed.write || parsed.rollback) && (!parsed.plan || !parsed.project)) {
    throw new Error(
      "--write and --rollback need --plan <file> and --project <id>",
    );
  }
  return parsed;
}

/** Comparable form of a plan's changes, for the write-time freshness check. */
const changeKey = (c: RemapDocChange) =>
  JSON.stringify([c.kind, c.path, c.mode]);

/**
 * Reasons a reviewed plan must not be written now. Pure, so every guard is
 * testable without Firebase.
 */
export function writeRefusals(input: {
  plan: RemapPlanFile;
  seasonNum: number;
  project: string;
  adminProjectId: string | null;
  mappingHash: string;
  ledgerHash: string | null;
  now: Date;
  maxPlanAgeHours: number;
  fresh: RemapDocumentPlan;
  ackLiveDrafts: readonly string[];
}): string[] {
  const { plan, fresh } = input;
  const out: string[] = [];
  if (plan.season_num !== input.seasonNum)
    out.push("the plan is for another season");
  if (input.adminProjectId !== input.project) {
    out.push(
      `--project ${input.project} is not the service account's project ${input.adminProjectId}`,
    );
  }
  if (plan.project_id !== input.project) {
    out.push(
      `the plan was made against ${plan.project_id}, not ${input.project}`,
    );
  }
  if (plan.mapping_hash !== input.mappingHash) {
    out.push(
      "the plan was made with a different mapping than the committed one",
    );
  }
  if (input.ledgerHash !== null && input.ledgerHash !== input.mappingHash) {
    out.push(`production is already marked with mapping ${input.ledgerHash}`);
  }
  const ageHours = (input.now.getTime() - Date.parse(plan.created_at)) / 3.6e6;
  if (!(ageHours <= input.maxPlanAgeHours)) {
    out.push(`the plan is ${ageHours.toFixed(1)}h old; dry-run again`);
  }
  if (plan.documents.problems.length > 0 || fresh.problems.length > 0) {
    out.push("the plan or a fresh read reports problems");
  }
  const reviewed = new Map(
    plan.documents.changes.map((c) => [changeKey(c), c]),
  );
  const same =
    reviewed.size === fresh.changes.length &&
    fresh.changes.every((c) => {
      const r = reviewed.get(changeKey(c));
      return (
        r !== undefined &&
        isDeepStrictEqual(r.before, c.before) &&
        isDeepStrictEqual(r.after, c.after)
      );
    });
  if (!same) {
    out.push("production changed since the plan was reviewed; dry-run again");
  }
  const unacked = fresh.live_drafts.filter(
    (p) => !input.ackLiveDrafts.includes(p),
  );
  if (unacked.length > 0) {
    out.push(
      `${unacked.length} draft(s) are live (users can still write castaway ids); wait, or acknowledge each with --ack-live-draft <path>`,
    );
  }
  return out;
}

const PROVISIONAL_HEADER =
  /^\/\/ Cast bootstrapped from the Survivor Wiki[\s\S]*?\n(?=import)/;

export const rewriteSeasonFileSource = (
  source: string,
  file: CastawayIdMappingFile,
): string =>
  rewriteSeasonSource(source, file.mappings).replace(
    PROVISIONAL_HEADER,
    `// Cast bootstrapped from the Survivor Wiki, then moved to survivoR's ids and\n` +
      `// names (doehm/survivoR@${file.upstream.commit.slice(0, 7)}) by\n` +
      `// \`yarn remap-castaway-ids ${file.season_num} --rewrite-season-file\`, mapping ${file.mapping_hash}.\n` +
      `// See docs/castaway-id-mapping.md.\n`,
  );

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

const countBy = <T>(items: readonly T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((acc, t) => {
    acc[key(t)] = (acc[key(t)] ?? 0) + 1;
    return acc;
  }, {});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { seasonNum } = args;
  if (seasonNum === null) {
    return fail(
      "no season given. Usage: yarn remap-castaway-ids <season> [--generate-mapping|--rewrite-season-file|--write|--rollback] ...",
    );
  }

  if (args.generateMapping) {
    const out = mappingFilePath(seasonNum);
    if (fs.existsSync(out))
      fail(`${out} already exists; the mapping is fixed once reviewed`);
    const [upstream, cast] = await Promise.all([
      loadUpstreamCast(args.upstream, seasonNum),
      loadCommittedCast(seasonNum),
    ]);
    const plan = planCastawayIdMapping(cast, upstream);
    for (const e of plan.errors) console.log(`  ERROR ${e}`);
    if (plan.errors.length > 0) fail("the mapping has errors");
    const file: CastawayIdMappingFile = {
      season_num: seasonNum,
      upstream: {
        repo: "doehm/survivoR",
        commit: args.upstream,
        tables: UPSTREAM_TABLES,
      },
      mapping_hash: plan.mapping_hash,
      mappings: plan.mappings,
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
    console.log(
      `Wrote ${out} (mapping ${plan.mapping_hash}). Review and commit it.`,
    );
    return;
  }

  const mapping = await verifiedMapping(seasonNum);
  console.log(
    `Mapping ${mapping.mapping_hash} (survivoR ${mapping.upstream.commit}) verified: ` +
      `${mapping.mappings.length} castaways, ${mapping.mappings.filter((m) => m.from !== m.to).length} ids change.`,
  );

  if (args.rewriteSeasonFile) {
    const file = seasonFilePath(seasonNum);
    const state = classifyCommittedCast(
      await loadCommittedCast(seasonNum),
      mapping.mappings,
    );
    if (state !== "provisional")
      fail(`the season file is ${state}, not provisional`);
    fs.writeFileSync(
      file,
      rewriteSeasonFileSource(fs.readFileSync(file, "utf-8"), mapping),
    );
    console.log(`Rewrote ${file}. Run yarn format, then review the diff.`);
    return;
  }

  const [propKeys, localCast] = await Promise.all([
    castawayPropBetKeys(),
    loadCommittedCast(seasonNum),
  ]);
  const localState = classifyCommittedCast(localCast, mapping.mappings);
  console.log(`Local season file: ${localState}`);

  const admin = await loadAdmin();
  const planFrom = async () => {
    const read = await readProduction(firebaseReader(admin), seasonNum);
    return {
      ...read,
      documents: planDocumentRemap(read.docs, {
        mappings: mapping.mappings,
        mappingHash: mapping.mapping_hash,
        castawayPropBetKeys: propKeys,
        ledger: read.ledger,
      }),
    };
  };

  if (args.write || args.rollback) {
    const plan = JSON.parse(
      fs.readFileSync(args.plan!, "utf-8"),
    ) as RemapPlanFile;
    const store = productionStore(admin, seasonNum, mapping.mapping_hash);
    if (args.rollback) {
      const refusals = [
        plan.season_num !== seasonNum && "the plan is for another season",
        admin.projectId !== args.project &&
          `--project ${args.project} is not the service account's project ${admin.projectId}`,
        plan.project_id !== args.project &&
          `the plan was made against ${plan.project_id}`,
        plan.mapping_hash !== mapping.mapping_hash &&
          "the plan used another mapping",
      ].filter((r): r is string => typeof r === "string");
      if (refusals.length > 0) fail(refusals.join("; "));
      const result = await rollbackCastawayIdRemap(
        plan.documents.changes,
        store,
      );
      console.log(
        `Rolled back ${result.applied.length} of ${plan.documents.changes.length}; ${result.stale.length} no longer held this plan's values.`,
      );
      process.exitCode = result.stale.length > 0 ? 1 : 0;
      return;
    }

    const fresh = await planFrom();
    const refusals = writeRefusals({
      plan,
      seasonNum,
      project: args.project!,
      adminProjectId: admin.projectId,
      mappingHash: mapping.mapping_hash,
      ledgerHash: fresh.ledgerHash,
      now: new Date(),
      maxPlanAgeHours: args.maxPlanAgeHours,
      fresh: fresh.documents,
      ackLiveDrafts: args.ackLiveDrafts,
    });
    if (refusals.length > 0) fail(refusals.join("; "));

    // Create the ledger before the first document so every Firestore
    // transaction can update it, and so the ADP job sees the remap has begun.
    const ledgerRef = admin.firestore
      .collection(REMAP_LEDGER_COLLECTION)
      .doc(remapLedgerDocId(seasonNum));
    await admin.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ledgerRef);
      if (!snap.exists) {
        tx.set(ledgerRef, {
          season_num: seasonNum,
          mapping_hash: mapping.mapping_hash,
          upstream_commit: mapping.upstream.commit,
          started_at: new Date().toISOString(),
          applied: {},
        });
      } else if (snap.data()?.mapping_hash !== mapping.mapping_hash) {
        throw new Error("The ledger belongs to another mapping");
      }
    });

    const result = await applyCastawayIdRemap(plan.documents.changes, store);
    console.log(
      `Applied ${result.applied.length} of ${plan.documents.changes.length}; ${result.stale.length} stale.`,
    );
    const after = await planFrom();
    console.log(
      `Re-read: ${after.documents.changes.length} changes left, ${after.documents.already_applied.length} applied, ${after.documents.problems.length} problems.`,
    );
    if (result.stale.length > 0 || after.documents.changes.length > 0) {
      console.log("Dry-run again and apply the new plan for what remains.");
      process.exitCode = 1;
    }
    return;
  }

  const { inventory, documents, ledgerHash } = await planFrom();
  console.log(`\nFirebase project: ${admin.projectId} (read-only)`);
  console.log("Inventory:");
  for (const [k, v] of Object.entries(inventory)) console.log(`  ${k}: ${v}`);
  if (ledgerHash) console.log(`  ledger mapping: ${ledgerHash}`);
  console.log(
    `Plan: ${documents.changes.length} documents to change ${JSON.stringify(countBy(documents.changes, (c) => `${c.kind}:${c.mode}`))}, ` +
      `${documents.changes.reduce((n, c) => n + c.id_changes, 0)} id values; ` +
      `${documents.unchanged.length} unchanged, ${documents.already_applied.length} already applied, ` +
      `${documents.problems.length} problems, ${documents.live_drafts.length} live drafts`,
  );
  if (documents.problems.length > 0) {
    console.log(
      `Problems by reason: ${JSON.stringify(countBy(documents.problems, (p) => p.reason))}`,
    );
  }

  const file: RemapPlanFile = {
    season_num: seasonNum,
    created_at: new Date().toISOString(),
    project_id: admin.projectId ?? "",
    mapping_hash: mapping.mapping_hash,
    upstream_commit: mapping.upstream.commit,
    local_season_file: localState,
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

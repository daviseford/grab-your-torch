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
 *   --write             Apply a reviewed plan. The first write begins the
 *                       cutover: it records a census of every document in the
 *                       ledger, then switches the season document first.
 *                       Later writes repair and mark what the census missed.
 *                       Refuses unless the plan is for this project, database
 *                       and mapping, is fresh, a new read plans exactly the
 *                       same changes, nothing global is wrong, and every live
 *                       draft it touches is acknowledged.
 *   --finalize          Close the cutover once every census document is on
 *                       survivoR's ids and the bundled season file is too.
 *                       Until then the sync push, ADP job and draft cleanup
 *                       refuse to touch the season.
 *   --rollback          Inside the cutover window only (not finalized, no
 *                       document created since it began): restore a plan's
 *                       `before` wherever its `after` is still in place,
 *                       clearing the marks. Newest plan first.
 *   --rewrite-season-file  Local only: rewrite src/data/season_N/index.ts
 *                       to survivoR's ids and names from the committed mapping,
 *                       adding no episode data. For the follow-up code PR.
 *   --backup <dir>      Read every document the remap can touch, whole, into
 *                       a private local folder outside any repository, with a
 *                       manifest of counts and sha256 checksums, and read it
 *                       back. The first --write requires one (--with-backup).
 *   --verify-backup <dir>  Local only: check a backup against its manifest.
 *   --restore-drill <dir>  Emulators only: restore a backup into the Firestore
 *                       and Database emulators and read every document back.
 *
 * Usage:
 *   yarn remap-castaway-ids 51 --generate-mapping [--upstream <sha>]
 *   yarn remap-castaway-ids 51 [--accept-born <path> ...]
 *   yarn remap-castaway-ids 51 --backup <absolute dir> --project survivor-fantasy-51c4b
 *   yarn remap-castaway-ids 51 --verify-backup <dir>
 *   firebase emulators:exec --only firestore,database --project demo-remap-drill "yarn remap-castaway-ids 51 --restore-drill <dir>"
 *   yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b --with-backup <dir> [--ack-live-draft drafts/<id> ...] [--accept-born <path> ...]
 *   yarn remap-castaway-ids 51 --finalize --project survivor-fantasy-51c4b
 *   yarn remap-castaway-ids 51 --rollback --plan <file> --project survivor-fantasy-51c4b
 *   yarn remap-castaway-ids 51 --rewrite-season-file
 *
 * The Admin SDK key defaults to `firebase-private-key.json` in the project
 * root; `FIREBASE_PRIVATE_KEY_PATH` overrides it (useful from a worktree).
 * The Realtime Database URL comes from `VITE_FIREBASE_DATABASE_URL` and must
 * belong to the same project.
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { isDeepStrictEqual } from "util";
import type { CastawayLookup } from "../src/types";
import {
  applyCastawayIdRemap,
  buildCensus,
  type CastawayIdMappingFile,
  type CastState,
  type Census,
  type CensusEntry,
  changedFields,
  classifyCommittedCast,
  type CommittedCastaway,
  fieldsEqual,
  planCastawayIdMapping,
  planDocumentRemap,
  type RemapApplyResult,
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
import {
  backupRefusals,
  type BackupScope,
  type BackupSource,
  createBackup,
  restoreBackupToEmulator,
  type RestoreTarget,
  verifyBackup,
} from "./lib/remap-backup.js";
import {
  databaseUrlRefusal,
  emulatorTargetRefusal,
  ledgerStatusOf,
  REMAP_LEDGER_COLLECTION,
  remapLedgerDocId,
  type RemapLedgerStatus,
} from "./lib/remap-ledger.js";

export { REMAP_LEDGER_COLLECTION, remapLedgerDocId };

/** survivoR commit that first published Season 51 (reviewed 2026-09-26). */
export const DEFAULT_UPSTREAM_COMMIT =
  "7336413e39c34c31231b9fa17281a47f731837e0";

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
  /** The Realtime Database the drafts were read from. */
  database_url: string;
  mapping_hash: string;
  upstream_commit: string;
  local_season_file: CastState;
  /** The cutover state when the plan was made; a write needs the same. */
  ledger_status: RemapLedgerStatus;
  /** `--accept-born` paths the plan was made with. */
  accept_born: string[];
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

export async function loadCommittedCast(
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

export async function castawayPropBetKeys(): Promise<Set<string>> {
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

export type Admin = {
  projectId: string | null;
  /** The Realtime Database instance the Admin SDK talks to. */
  databaseUrl: string | null;
  /**
   * The environment the Admin SDK was configured from: emulator host
   * variables silently redirect it, whatever the project.
   */
  env: Readonly<Record<string, string | undefined>>;
  firestore: import("firebase-admin/firestore").Firestore;
  rtdb: import("firebase-admin/database").Database;
};

async function loadAdmin(): Promise<Admin> {
  const { adminApp } = await import("./lib/admin.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getDatabase } = await import("firebase-admin/database");
  return {
    projectId: adminApp.options.projectId ?? null,
    databaseUrl: adminApp.options.databaseURL ?? null,
    env: process.env,
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

export type ProductionRead = {
  docs: RemapSourceDoc[];
  inventory: Record<string, number | boolean>;
  ledger: Map<string, string>;
  ledgerHash: string | null;
  ledgerStatus: RemapLedgerStatus;
  /** Null until a cutover begins, and again after a rollback. */
  census: Census | null;
};

export async function readProduction(
  reader: ProductionReader,
  seasonNum: number,
): Promise<ProductionRead> {
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

  const rawLedger = await reader.doc(
    `${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(seasonNum)}`,
  );
  const ledgerDoc = plain(rawLedger);
  const ledgerStatus = ledgerStatusOf(rawLedger);
  const ledger = new Map<string, string>();
  const applied = ledgerDoc.applied;
  if (applied && typeof applied === "object") {
    for (const [p, v] of Object.entries(applied as Record<string, unknown>)) {
      const h = (v as { mapping_hash?: unknown })?.mapping_hash;
      if (typeof h === "string") ledger.set(p, h);
    }
  }
  const rawCensus = ledgerDoc.census;
  const census =
    (ledgerStatus === "in_progress" || ledgerStatus === "finalized") &&
    rawCensus &&
    typeof rawCensus === "object"
      ? new Map(Object.entries(rawCensus as Record<string, CensusEntry>))
      : null;
  if (
    census === null &&
    (ledgerStatus === "in_progress" || ledgerStatus === "finalized")
  ) {
    // A ledger from before the census existed cannot tell born documents
    // from pre-existing ones; stop rather than guess.
    throw new Error(
      "The remap ledger has no census; it predates this tool version. Stop and inspect it.",
    );
  }
  inventory.ledger_applied_paths = ledger.size;
  inventory.ledger_census_paths = census?.size ?? 0;
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
    ledgerStatus,
    census,
  };
}

/** Whether `mark` may be applied given the document's current mark hash. */
export const markAllows = (
  mark: RemapMark,
  current: string | undefined,
  hash: string,
): boolean =>
  mark === "set" || mark === "absent"
    ? current === undefined
    : current === hash;

/** Whether a committed document carries the mark `mark` should leave. */
export const markHolds = (
  mark: RemapMark,
  stored: string | undefined,
  hash: string,
): boolean =>
  mark === "clear" || mark === "absent"
    ? stored === undefined
    : stored === hash;

const markerHash = (node: Record<string, unknown>): string | undefined => {
  const marker = node[RTDB_REMAP_MARKER] as { mapping_hash?: unknown };
  return typeof marker?.mapping_hash === "string"
    ? marker.mapping_hash
    : undefined;
};

export function productionStore(
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
      const writes = changedFields(expected, next);
      const origin = change.mode === "born" ? "born" : "remapped";
      if (change.kind === "rtdb_draft") {
        const result = await rtdb.ref(change.path).transaction((current) => {
          // The SDK may call this first with its local copy of the node,
          // which is null when this process holds none. Aborting on that
          // guess would end the transaction without asking the server, so
          // null is answered with null: if the server holds data, its hash
          // differs, the write is rejected and this runs again with the real
          // value. If the node really is absent, null is committed (nothing
          // changes) and the check after the commit reports it stale.
          if (current === null) return null;
          const node = plain(current);
          if (
            !fieldsEqual(node, expected) ||
            !markAllows(mark, markerHash(node), hash)
          ) {
            return; // abort: nothing written
          }
          const updated: Record<string, unknown> = { ...current, ...writes };
          if (mark === "set") {
            updated[RTDB_REMAP_MARKER] = {
              mapping_hash: hash,
              applied_at: now,
              origin,
            };
          } else if (mark === "clear") {
            delete updated[RTDB_REMAP_MARKER];
          }
          return updated;
        });
        if (!result.committed || !result.snapshot.exists()) return false;
        // Check what was committed, fields and mark, rather than trusting
        // that the handler's last run was the one that wrote.
        const stored = plain(result.snapshot.val());
        return (
          fieldsEqual(stored, next) && markHolds(mark, markerHash(stored), hash)
        );
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
        const pairs = Object.entries(writes).flatMap(([k, v]) => [
          new FieldPath(k),
          v === null ? FieldValue.delete() : v,
        ]);
        if (pairs.length > 0) {
          const [first, firstValue, ...rest] = pairs;
          tx.update(
            ref,
            first as InstanceType<typeof FieldPath>,
            firstValue,
            ...rest,
          );
        }
        if (mark === "set" || mark === "clear") {
          tx.update(
            ledgerRef,
            new FieldPath("applied", change.path),
            mark === "set"
              ? {
                  mapping_hash: hash,
                  applied_at: now,
                  kind: change.kind,
                  origin,
                }
              : FieldValue.delete(),
          );
        }
        return true;
      });
    },
  };
}

export type StoreFactory = (
  admin: Admin,
  seasonNum: number,
  hash: string,
) => RemapStore;

/* ------------------------------------------------------------------ *
 * Local backup adapters
 * ------------------------------------------------------------------ */

export function backupSourceOf(admin: Admin): BackupSource & RestoreTarget {
  return {
    projectId: admin.projectId,
    databaseUrl: admin.databaseUrl,
    env: admin.env,
    async readFirestore(paths) {
      const out = new Map<string, unknown | null>();
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        if (chunk.length === 0) continue;
        const snaps = await admin.firestore.getAll(
          ...chunk.map((p) => admin.firestore.doc(p)),
        );
        snaps.forEach((snap, j) =>
          out.set(chunk[j], snap.exists ? snap.data() : null),
        );
      }
      return out;
    },
    async readRtdb(paths) {
      const out = new Map<string, unknown | null>();
      for (const p of paths) {
        out.set(p, (await admin.rtdb.ref(p).once("value")).val());
      }
      return out;
    },
    async writeFirestore(docs) {
      for (const [p, d] of docs) {
        await admin.firestore.doc(p).set(d as Record<string, unknown>);
      }
    },
    async writeRtdb(nodes) {
      for (const [p, n] of nodes) await admin.rtdb.ref(p).set(n);
    },
    makeTimestamp: (seconds, nanoseconds) => {
      throw new Error(`no timestamp factory (${seconds}, ${nanoseconds})`);
    },
  };
}

/** Every Firestore document and RTDB draft the remap reads, plus the ledger. */
export async function backupScope(
  admin: Admin,
  seasonNum: number,
): Promise<BackupScope> {
  const target = emulatorTargetRefusal(admin.env, admin.projectId);
  if (target) throw new Error(`Refusing to run: ${target}`);
  const read = await readProduction(firebaseReader(admin), seasonNum);
  return {
    firestore: [
      ...read.docs.filter((d) => d.kind !== "rtdb_draft").map((d) => d.path),
      `${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(seasonNum)}`,
    ],
    rtdb: read.docs.filter((d) => d.kind === "rtdb_draft").map((d) => d.path),
  };
}

export async function runBackup(
  admin: Admin,
  ctx: Pick<RemapContext, "seasonNum" | "mapping">,
  outDir: string,
  toolCommit: string | null,
) {
  return createBackup(
    backupSourceOf(admin),
    await backupScope(admin, ctx.seasonNum),
    outDir,
    {
      seasonNum: ctx.seasonNum,
      mappingHash: ctx.mapping.mapping_hash,
      toolCommit,
    },
  );
}

export async function runRestoreDrill(admin: Admin, dir: string) {
  const { Timestamp } = await import("firebase-admin/firestore");
  return restoreBackupToEmulator(
    {
      ...backupSourceOf(admin),
      makeTimestamp: (seconds, nanoseconds) =>
        new Timestamp(seconds, nanoseconds),
    },
    dir,
  );
}

/* ------------------------------------------------------------------ *
 * Flows (exported so the emulator tests run exactly what the CLI runs)
 * ------------------------------------------------------------------ */

export type RemapContext = {
  seasonNum: number;
  mapping: CastawayIdMappingFile;
  propKeys: ReadonlySet<string>;
  acceptBorn: readonly string[];
};

export async function planFromProduction(
  admin: Admin,
  ctx: RemapContext,
): Promise<{ read: ProductionRead; documents: RemapDocumentPlan }> {
  // Every flow reads through here first, so a run aimed at one place while
  // the SDK talks to another stops before reading or writing anything.
  const target = emulatorTargetRefusal(admin.env, admin.projectId);
  if (target) throw new Error(`Refusing to run: ${target}`);
  const read = await readProduction(firebaseReader(admin), ctx.seasonNum);
  if (
    read.ledgerHash !== null &&
    read.ledgerHash !== ctx.mapping.mapping_hash
  ) {
    throw new Error(
      `Production is marked with mapping ${read.ledgerHash}, not ${ctx.mapping.mapping_hash}`,
    );
  }
  return {
    read,
    documents: planDocumentRemap(read.docs, {
      mappings: ctx.mapping.mappings,
      mappingHash: ctx.mapping.mapping_hash,
      castawayPropBetKeys: ctx.propKeys,
      ledger: read.ledger,
      census: read.census,
      acceptBorn: new Set(ctx.acceptBorn),
    }),
  };
}

export async function dryRun(
  admin: Admin,
  ctx: RemapContext,
  localState: CastState,
  now = new Date(),
): Promise<RemapPlanFile> {
  const { read, documents } = await planFromProduction(admin, ctx);
  return {
    season_num: ctx.seasonNum,
    created_at: now.toISOString(),
    project_id: admin.projectId ?? "",
    database_url: admin.databaseUrl ?? "",
    mapping_hash: ctx.mapping.mapping_hash,
    upstream_commit: ctx.mapping.upstream.commit,
    local_season_file: localState,
    ledger_status: read.ledgerStatus,
    accept_born: [...ctx.acceptBorn].sort(),
    inventory: read.inventory,
    documents,
  };
}

/** Refusals shared by every production write: project, database, mapping. */
export function targetRefusals(input: {
  plan?: Pick<
    RemapPlanFile,
    "season_num" | "project_id" | "database_url" | "mapping_hash"
  >;
  seasonNum: number;
  project: string;
  adminProjectId: string | null;
  databaseUrl: string | null;
  mappingHash: string;
  ledgerHash: string | null;
}): string[] {
  const out: string[] = [];
  const { plan } = input;
  if (input.adminProjectId !== input.project) {
    out.push(
      `--project ${input.project} is not the service account's project ${input.adminProjectId}`,
    );
  }
  const db = databaseUrlRefusal(input.databaseUrl, input.project);
  if (db) out.push(db);
  if (input.ledgerHash !== null && input.ledgerHash !== input.mappingHash) {
    out.push(`production is already marked with mapping ${input.ledgerHash}`);
  }
  if (plan) {
    if (plan.season_num !== input.seasonNum) {
      out.push("the plan is for another season");
    }
    if (plan.project_id !== input.project) {
      out.push(
        `the plan was made against ${plan.project_id}, not ${input.project}`,
      );
    }
    if (plan.database_url !== input.databaseUrl) {
      out.push(
        `the plan read drafts from ${plan.database_url}, not ${input.databaseUrl}`,
      );
    }
    if (plan.mapping_hash !== input.mappingHash) {
      out.push(
        "the plan was made with a different mapping than the committed one",
      );
    }
  }
  return out;
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
  databaseUrl: string | null;
  mappingHash: string;
  ledgerHash: string | null;
  ledgerStatus: RemapLedgerStatus;
  now: Date;
  maxPlanAgeHours: number;
  fresh: RemapDocumentPlan;
  ackLiveDrafts: readonly string[];
  acceptBorn: readonly string[];
}): string[] {
  const { plan, fresh } = input;
  const out = targetRefusals(input);
  if (plan.ledger_status !== input.ledgerStatus) {
    out.push(
      `the cutover was ${plan.ledger_status} when the plan was made and is ${input.ledgerStatus} now; dry-run again`,
    );
  }
  if (
    !isDeepStrictEqual(
      [...plan.accept_born].sort(),
      [...input.acceptBorn].sort(),
    )
  ) {
    out.push("--accept-born differs from the plan's");
  }
  const ageHours = (input.now.getTime() - Date.parse(plan.created_at)) / 3.6e6;
  if (!(ageHours <= input.maxPlanAgeHours)) {
    out.push(`the plan is ${ageHours.toFixed(1)}h old; dry-run again`);
  }
  const all = [...plan.documents.problems, ...fresh.problems];
  if (all.some((p) => p.scope === "global")) {
    out.push("the plan or a fresh read reports a global problem");
  }
  const beginning =
    input.ledgerStatus === "none" || input.ledgerStatus === "rolled_back";
  if (beginning && all.length > 0) {
    out.push("the cutover can only begin from a plan with no problems");
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
  const unacked = fresh.changes
    .filter((c) => fresh.live_drafts.includes(c.path))
    .filter((c) => !input.ackLiveDrafts.includes(c.path));
  if (unacked.length > 0) {
    out.push(
      `${unacked.length} draft(s) the plan writes are live (users can still write castaway ids); wait, or acknowledge each with --ack-live-draft <path>`,
    );
  }
  return out;
}

const ledgerRefOf = (admin: Admin, seasonNum: number) =>
  admin.firestore
    .collection(REMAP_LEDGER_COLLECTION)
    .doc(remapLedgerDocId(seasonNum));

export type WriteOutcome =
  | { refusals: string[] }
  | {
      refusals: [];
      result: RemapApplyResult;
      began: boolean;
      after: RemapDocumentPlan;
    };

export async function runWrite(
  admin: Admin,
  ctx: RemapContext,
  input: {
    plan: RemapPlanFile;
    project: string;
    ackLiveDrafts: readonly string[];
    maxPlanAgeHours: number;
    /** A verified local backup; required to begin the cutover. */
    backupDir?: string | null;
    now?: Date;
    /** Tests inject failures here; the CLI always uses productionStore. */
    storeFor?: StoreFactory;
  },
): Promise<WriteOutcome> {
  const hash = ctx.mapping.mapping_hash;
  const now = input.now ?? new Date();
  const fresh = await planFromProduction(admin, ctx);
  const refusals = writeRefusals({
    plan: input.plan,
    seasonNum: ctx.seasonNum,
    project: input.project,
    adminProjectId: admin.projectId,
    databaseUrl: admin.databaseUrl,
    mappingHash: hash,
    ledgerHash: fresh.read.ledgerHash,
    ledgerStatus: fresh.read.ledgerStatus,
    now,
    maxPlanAgeHours: input.maxPlanAgeHours,
    fresh: fresh.documents,
    ackLiveDrafts: input.ackLiveDrafts,
    acceptBorn: ctx.acceptBorn,
  });

  const began =
    fresh.read.ledgerStatus === "none" ||
    fresh.read.ledgerStatus === "rolled_back";
  if (began) {
    // Nothing may be written before a verified local backup holds every
    // document this write can touch.
    if (!input.backupDir) {
      refusals.push(
        "beginning the cutover needs a verified local backup: --with-backup <dir> (see --backup)",
      );
    } else {
      refusals.push(
        ...backupRefusals({
          check: verifyBackup(input.backupDir),
          project: input.project,
          databaseUrl: admin.databaseUrl,
          seasonNum: ctx.seasonNum,
          mappingHash: hash,
          now,
          maxAgeHours: input.maxPlanAgeHours,
          freshPaths: fresh.read.docs.map((d) => d.path),
        }),
      );
    }
  }
  if (refusals.length > 0) return { refusals };

  if (began) {
    // Begin the cutover: the census is every document the fresh read saw.
    // Anything created from here on is classified, never remapped, and the
    // other jobs hold the season until --finalize.
    const ref = ledgerRefOf(admin, ctx.seasonNum);
    await admin.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const status = snap.exists ? ledgerStatusOf(snap.data()) : "none";
      if (status !== fresh.read.ledgerStatus) {
        throw new Error("The ledger changed since the fresh read");
      }
      const prior = snap.data() ?? {};
      if (snap.exists && prior.mapping_hash !== hash) {
        throw new Error("The ledger belongs to another mapping");
      }
      if (Object.keys(prior.applied ?? {}).length > 0) {
        throw new Error(
          "The rolled-back ledger still records applied documents",
        );
      }
      tx.set(ref, {
        season_num: ctx.seasonNum,
        mapping_hash: hash,
        upstream_commit: ctx.mapping.upstream.commit,
        status: "in_progress",
        started_at: new Date().toISOString(),
        census: buildCensus(fresh.read.docs),
        applied: {},
        ...(prior.rolled_back_at
          ? { previous_rollback_at: prior.rolled_back_at }
          : {}),
      });
    });
  }

  const result = await applyCastawayIdRemap(
    input.plan.documents.changes,
    (input.storeFor ?? productionStore)(admin, ctx.seasonNum, hash),
  );
  const after = await planFromProduction(admin, ctx);
  return { refusals: [], result, began, after: after.documents };
}

/** Census documents that still exist and are not marked applied. */
export const unmarkedCensus = (read: ProductionRead, hash: string): string[] =>
  read.census === null
    ? read.docs.filter((d) => d.kind !== "season_results").map((d) => d.path)
    : read.docs
        .filter((d) => read.census!.has(d.path))
        .filter((d) =>
          d.kind === "rtdb_draft"
            ? markerHash(d.data) !== hash
            : read.ledger.get(d.path) !== hash,
        )
        .map((d) => d.path);

/** Documents that exist now but were not there when the cutover began. */
export const bornSinceCensus = (read: ProductionRead): string[] =>
  read.census === null
    ? []
    : read.docs
        .filter((d) => d.kind !== "season_results")
        .filter((d) => !read.census!.has(d.path))
        .map((d) => d.path);

export async function runFinalize(
  admin: Admin,
  ctx: RemapContext,
  input: { project: string; localState: CastState },
): Promise<{ refusals: string[] }> {
  const hash = ctx.mapping.mapping_hash;
  const { read, documents } = await planFromProduction(admin, ctx);
  const refusals = targetRefusals({
    seasonNum: ctx.seasonNum,
    project: input.project,
    adminProjectId: admin.projectId,
    databaseUrl: admin.databaseUrl,
    mappingHash: hash,
    ledgerHash: read.ledgerHash,
  });
  if (read.ledgerStatus !== "in_progress") {
    refusals.push(`the cutover is ${read.ledgerStatus}, not in progress`);
  }
  if (input.localState !== "remapped") {
    refusals.push(
      `the bundled season file is ${input.localState}; merge the rewritten season file first and finalize from it`,
    );
  }
  if (documents.changes.length > 0) {
    refusals.push(`${documents.changes.length} change(s) are still planned`);
  }
  if (documents.problems.length > 0) {
    refusals.push(`${documents.problems.length} problem(s) are unresolved`);
  }
  const unmarked = unmarkedCensus(read, hash);
  if (unmarked.length > 0) {
    refusals.push(`${unmarked.length} census document(s) are not marked`);
  }
  if (refusals.length > 0) return { refusals };

  const ref = ledgerRefOf(admin, ctx.seasonNum);
  await admin.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (ledgerStatusOf(snap.data()) !== "in_progress") {
      throw new Error("The ledger changed since the fresh read");
    }
    tx.update(ref, {
      status: "finalized",
      finalized_at: new Date().toISOString(),
    });
  });
  return { refusals: [] };
}

export type RollbackOutcome =
  | { refusals: string[] }
  | { refusals: []; result: RemapApplyResult; rolledBack: boolean };

export async function runRollback(
  admin: Admin,
  ctx: RemapContext,
  input: { plan: RemapPlanFile; project: string; storeFor?: StoreFactory },
): Promise<RollbackOutcome> {
  const hash = ctx.mapping.mapping_hash;
  const { read } = await planFromProduction(admin, ctx);
  const refusals = targetRefusals({
    plan: input.plan,
    seasonNum: ctx.seasonNum,
    project: input.project,
    adminProjectId: admin.projectId,
    databaseUrl: admin.databaseUrl,
    mappingHash: hash,
    ledgerHash: read.ledgerHash,
  });
  if (read.ledgerStatus === "finalized") {
    refusals.push(
      "the cutover is finalized; roll forward (repair) instead of back",
    );
  } else if (read.ledgerStatus !== "in_progress") {
    refusals.push(`the cutover is ${read.ledgerStatus}; nothing to roll back`);
  }
  const born = bornSinceCensus(read);
  if (born.length > 0) {
    refusals.push(
      `${born.length} document(s) were created since the cutover began, on survivoR's ids; rolling back would strand them, so roll forward instead`,
    );
  }
  if (refusals.length > 0) return { refusals };

  const result = await rollbackCastawayIdRemap(
    input.plan.documents.changes,
    (input.storeFor ?? productionStore)(admin, ctx.seasonNum, hash),
  );

  // Once nothing is marked, the season is provisional again.
  const after = await readProduction(firebaseReader(admin), ctx.seasonNum);
  const marked = after.docs.filter((d) =>
    d.kind === "rtdb_draft"
      ? markerHash(d.data) !== undefined
      : after.ledger.has(d.path),
  );
  let rolledBack = false;
  if (marked.length === 0 && after.ledger.size === 0) {
    const ref = ledgerRefOf(admin, ctx.seasonNum);
    rolledBack = await admin.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const applied = snap.data()?.applied ?? {};
      if (
        ledgerStatusOf(snap.data()) !== "in_progress" ||
        Object.keys(applied).length > 0
      ) {
        return false;
      }
      tx.update(ref, {
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
      });
      return true;
    });
  }
  return { refusals: [], result, rolledBack };
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
  finalize: boolean;
  plan: string | null;
  project: string | null;
  ackLiveDrafts: string[];
  acceptBorn: string[];
  maxPlanAgeHours: number;
  /** Create a local backup in this folder (reads production, writes files). */
  backup: string | null;
  /** Check a local backup against its manifest (no Firebase access). */
  verifyBackup: string | null;
  /** Restore a local backup into the emulators and verify it (drill). */
  restoreDrill: string | null;
  /** The verified local backup a write that begins the cutover requires. */
  withBackup: string | null;
};

export function parseArgs(argv: readonly string[]): Args {
  const parsed: Args = {
    seasonNum: null,
    upstream: DEFAULT_UPSTREAM_COMMIT,
    generateMapping: false,
    rewriteSeasonFile: false,
    write: false,
    rollback: false,
    finalize: false,
    plan: null,
    project: null,
    ackLiveDrafts: [],
    acceptBorn: [],
    maxPlanAgeHours: 6,
    backup: null,
    verifyBackup: null,
    restoreDrill: null,
    withBackup: null,
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
    else if (arg === "--finalize") parsed.finalize = true;
    else if (arg === "--generate-mapping") parsed.generateMapping = true;
    else if (arg === "--rewrite-season-file") parsed.rewriteSeasonFile = true;
    else if (arg === "--upstream") parsed.upstream = value(++i, arg);
    else if (arg === "--plan") parsed.plan = value(++i, arg);
    else if (arg === "--project") parsed.project = value(++i, arg);
    else if (arg === "--ack-live-draft") {
      parsed.ackLiveDrafts.push(value(++i, arg));
    } else if (arg === "--backup") parsed.backup = value(++i, arg);
    else if (arg === "--verify-backup") parsed.verifyBackup = value(++i, arg);
    else if (arg === "--restore-drill") parsed.restoreDrill = value(++i, arg);
    else if (arg === "--with-backup") parsed.withBackup = value(++i, arg);
    else if (arg === "--accept-born") {
      parsed.acceptBorn.push(value(++i, arg));
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
    parsed.finalize,
    parsed.generateMapping,
    parsed.rewriteSeasonFile,
    parsed.backup !== null,
    parsed.verifyBackup !== null,
    parsed.restoreDrill !== null,
  ].filter(Boolean).length;
  if (modes > 1) {
    throw new Error(
      "--write, --rollback, --finalize, --generate-mapping, --rewrite-season-file, --backup, --verify-backup and --restore-drill are exclusive",
    );
  }
  if ((parsed.write || parsed.rollback) && (!parsed.plan || !parsed.project)) {
    throw new Error(
      "--write and --rollback need --plan <file> and --project <id>",
    );
  }
  if ((parsed.finalize || parsed.backup) && !parsed.project) {
    throw new Error("--finalize and --backup need --project <id>");
  }
  if (parsed.withBackup !== null && !parsed.write) {
    throw new Error("--with-backup goes with --write");
  }
  return parsed;
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

const describeDocuments = (documents: RemapDocumentPlan): string[] => {
  const lines = [
    `Plan: ${documents.changes.length} documents to change ${JSON.stringify(countBy(documents.changes, (c) => `${c.kind}:${c.mode}`))}, ` +
      `${documents.changes.reduce((n, c) => n + c.id_changes, 0)} id values; ` +
      `${documents.already_applied.length} already applied, ${documents.born_pending.length} created since the cutover and not yet classifiable, ` +
      `${documents.problems.length} problems, ${documents.live_drafts.length} live drafts`,
  ];
  if (documents.problems.length > 0) {
    lines.push(
      `Problems by scope and reason: ${JSON.stringify(countBy(documents.problems, (p) => `${p.scope}:${p.reason}`))}`,
    );
  }
  return lines;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { seasonNum } = args;
  if (seasonNum === null) {
    return fail(
      "no season given. Usage: yarn remap-castaway-ids <season> [--generate-mapping|--rewrite-season-file|--write|--finalize|--rollback] ...",
    );
  }

  if (args.verifyBackup) {
    // Local only: no Firebase, no network.
    const check = verifyBackup(args.verifyBackup);
    if (check.errors.length > 0 || !check.manifest) {
      return fail(`the backup does not verify: ${check.errors.join("; ")}`);
    }
    const m = check.manifest;
    console.log(
      `Backup verified: ${m.project_id}, season ${m.season_num}, taken ${m.created_at}, ` +
        `${m.counts.firestore} Firestore documents and ${m.counts.rtdb} RTDB drafts, checksums match.`,
    );
    return;
  }

  if (args.restoreDrill) {
    // Emulators only: the Admin app is built for the emulators' demo project,
    // never from the service account key.
    const projectId = process.env.GCLOUD_PROJECT ?? "";
    const target = emulatorTargetRefusal(process.env, projectId);
    if (target || !process.env.FIRESTORE_EMULATOR_HOST) {
      return fail(
        `the restore drill runs only inside firebase emulators:exec with a demo- project${target ? ` (${target})` : ""}`,
      );
    }
    const { initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getDatabase } = await import("firebase-admin/database");
    const databaseUrl = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${projectId}-default-rtdb`;
    const app = initializeApp(
      { projectId, databaseURL: databaseUrl },
      "restore-drill",
    );
    const drill = await runRestoreDrill(
      {
        projectId,
        databaseUrl,
        env: process.env,
        firestore: getFirestore(app),
        rtdb: getDatabase(app),
      },
      args.restoreDrill,
    );
    if (drill.mismatches.length > 0) {
      return fail(
        `${drill.mismatches.length} document(s) did not read back identically`,
      );
    }
    console.log(
      `Restore drill passed: ${drill.firestore} Firestore documents and ${drill.rtdb} RTDB drafts restored into the emulators and read back identically.`,
    );
    return;
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
  const ctx: RemapContext = {
    seasonNum,
    mapping,
    propKeys,
    acceptBorn: args.acceptBorn,
  };

  const admin = await loadAdmin();

  if (args.backup) {
    if (admin.projectId !== args.project) {
      return fail(
        `--project ${args.project} is not the service account's project ${admin.projectId}`,
      );
    }
    let toolCommit: string | null = null;
    try {
      const { execSync } = await import("child_process");
      toolCommit = execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT })
        .toString()
        .trim();
    } catch {
      toolCommit = null;
    }
    const { manifest, manifestSha256 } = await runBackup(
      admin,
      ctx,
      args.backup,
      toolCommit,
    );
    console.log(
      `Backup written and read back: ${manifest.counts.firestore} Firestore documents, ` +
        `${manifest.counts.rtdb} RTDB drafts, manifest sha256 ${manifestSha256}.`,
    );
    console.log(
      `Folder: ${args.backup}. It holds users' data: keep it private, never commit or share it.`,
    );
    console.log(
      "Next: --verify-backup, then the restore drill in the emulators.",
    );
    return;
  }

  const readPlan = () =>
    JSON.parse(fs.readFileSync(args.plan!, "utf-8")) as RemapPlanFile;

  if (args.rollback) {
    const outcome = await runRollback(admin, ctx, {
      plan: readPlan(),
      project: args.project!,
    });
    if (!("result" in outcome)) return fail(outcome.refusals.join("; "));
    console.log(
      `Rolled back ${outcome.result.applied.length}; ${outcome.result.stale.length} no longer held this plan's values.` +
        (outcome.rolledBack
          ? " Nothing is marked any more: the cutover is rolled back."
          : " Documents are still marked: roll back the next-older plan."),
    );
    process.exitCode = outcome.result.stale.length > 0 ? 1 : 0;
    return;
  }

  if (args.finalize) {
    const outcome = await runFinalize(admin, ctx, {
      project: args.project!,
      localState,
    });
    if (outcome.refusals.length > 0) return fail(outcome.refusals.join("; "));
    console.log(
      "Finalized: the sync push, ADP job and draft cleanup may touch the season again.",
    );
    return;
  }

  if (args.write) {
    const outcome = await runWrite(admin, ctx, {
      plan: readPlan(),
      project: args.project!,
      ackLiveDrafts: args.ackLiveDrafts,
      maxPlanAgeHours: args.maxPlanAgeHours,
      backupDir: args.withBackup,
    });
    if (!("result" in outcome)) return fail(outcome.refusals.join("; "));
    if (outcome.began) console.log("Cutover begun: census recorded.");
    console.log(
      `Applied ${outcome.result.applied.length}; ${outcome.result.stale.length} stale.`,
    );
    console.log("Re-read:");
    for (const line of describeDocuments(outcome.after))
      console.log(`  ${line}`);
    if (
      outcome.result.stale.length > 0 ||
      outcome.after.changes.length > 0 ||
      outcome.after.problems.length > 0
    ) {
      console.log(
        "Dry-run again, resolve what it reports, and apply the new plan.",
      );
      process.exitCode = 1;
    }
    return;
  }

  const file = await dryRun(admin, ctx, localState);
  const target = databaseUrlRefusal(admin.databaseUrl, admin.projectId);
  console.log(`\nFirebase project: ${admin.projectId} (read-only)`);
  console.log(
    `Realtime Database: ${target ? `WARNING, ${target}` : "belongs to the project"}`,
  );
  console.log(`Cutover: ${file.ledger_status}`);
  console.log("Inventory:");
  for (const [k, v] of Object.entries(file.inventory)) {
    console.log(`  ${k}: ${v}`);
  }
  for (const line of describeDocuments(file.documents)) console.log(line);

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

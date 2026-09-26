/**
 * A genuinely local, verified backup of everything a castaway id remap
 * touches, taken before the cutover begins.
 *
 * Scope: every Firestore document and RTDB draft `readProduction` reads for
 * the season (competitions, trades, drafts, the pool config and entries, the
 * season document, team assignments, results, ADP summaries) plus the remap
 * ledger if it exists. Whole documents, not just the fields the remap
 * changes: the plan file already holds those.
 *
 * Files, in a private directory outside any git work tree:
 * - `firestore.json`: `{ path: document }`, with Firestore timestamps
 *   type-tagged so a restore writes them back as timestamps. Any other
 *   non-JSON Firestore type refuses the backup rather than being flattened.
 * - `rtdb.json`: `{ path: node }` (RTDB is plain JSON).
 * - `manifest.json`: target project, database, season, mapping, time, tool
 *   commit, counts, each file's size and sha256, and each document's sha256.
 *
 * The backup is read back from disk and checked against the manifest before
 * it counts. Nothing here prints document contents; they hold users' names
 * and ids. Restore goes to the emulators only (the drill): recovering
 * production is a separate, explicitly authorized operation.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { databaseUrlRefusal, emulatorTargetRefusal } from "./remap-ledger.js";

export const BACKUP_FORMAT = 1;
export const BACKUP_FILES = ["firestore.json", "rtdb.json"] as const;
type BackupFile = (typeof BACKUP_FILES)[number];

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  kind: "castaway_id_remap_backup";
  season_num: number;
  project_id: string;
  database_url: string;
  mapping_hash: string;
  created_at: string;
  tool_commit: string | null;
  counts: {
    firestore: number;
    rtdb: number;
    by_collection: Record<string, number>;
  };
  files: Record<BackupFile, { bytes: number; sha256: string }>;
  /** sha256 of each document's canonical JSON, keyed by path. */
  doc_hashes: Record<string, string>;
};

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

const TYPE_TAG = "__backup_type";

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

type TimestampLike = { seconds: number; nanoseconds: number; toDate(): Date };
const isTimestamp = (v: unknown): v is TimestampLike =>
  typeof v === "object" &&
  v !== null &&
  v.constructor?.name === "Timestamp" &&
  typeof (v as TimestampLike).seconds === "number" &&
  typeof (v as TimestampLike).nanoseconds === "number";

/**
 * Firestore data to JSON. Timestamps are tagged; any other non-JSON type
 * (references, geopoints, bytes, vectors, non-finite numbers) throws, so a
 * backup never silently loses type information.
 */
export function encodeFirestoreValue(v: unknown, at = "$"): unknown {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`${at}: non-finite number`);
    return v;
  }
  if (Array.isArray(v))
    return v.map((x, i) => encodeFirestoreValue(x, `${at}[${i}]`));
  if (isTimestamp(v)) {
    return {
      [TYPE_TAG]: "timestamp",
      seconds: v.seconds,
      nanoseconds: v.nanoseconds,
    };
  }
  if (isPlainObject(v)) {
    if (TYPE_TAG in v)
      throw new Error(`${at}: holds the reserved key ${TYPE_TAG}`);
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        encodeFirestoreValue(x, `${at}.${k}`),
      ]),
    );
  }
  throw new Error(
    `${at}: unsupported Firestore type ${(v as object)?.constructor?.name ?? typeof v}`,
  );
}

export function decodeFirestoreValue(
  v: unknown,
  makeTimestamp: (seconds: number, nanoseconds: number) => unknown,
): unknown {
  if (Array.isArray(v))
    return v.map((x) => decodeFirestoreValue(x, makeTimestamp));
  if (isPlainObject(v)) {
    if (v[TYPE_TAG] === "timestamp") {
      return makeTimestamp(Number(v.seconds), Number(v.nanoseconds));
    }
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        decodeFirestoreValue(x, makeTimestamp),
      ]),
    );
  }
  return v;
}

/** JSON with object keys sorted, so equal data always hashes the same. */
export const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    isPlainObject(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );

const sha256 = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");

/* ------------------------------------------------------------------ *
 * Output directory
 * ------------------------------------------------------------------ */

/** The nearest enclosing git work tree (a `.git` file or folder), if any. */
export const enclosingGitTree = (dir: string): string | null => {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
};

/** Why `dir` must not receive a backup, or null. */
export const backupDirRefusal = (dir: string): string | null => {
  if (!path.isAbsolute(dir)) return `${dir} is not an absolute path`;
  const tree = enclosingGitTree(dir);
  if (tree)
    return `${dir} is inside the git work tree ${tree}; use a private folder outside any repository`;
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    return `${dir} is not empty; each backup gets a new folder`;
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * Create, verify, restore
 * ------------------------------------------------------------------ */

export type BackupSource = {
  projectId: string | null;
  databaseUrl: string | null;
  env: Readonly<Record<string, string | undefined>>;
  /** Raw Firestore documents by path (null when absent). */
  readFirestore(paths: readonly string[]): Promise<Map<string, unknown | null>>;
  /** RTDB nodes by path (null when absent). */
  readRtdb(paths: readonly string[]): Promise<Map<string, unknown | null>>;
};

export type BackupScope = { firestore: string[]; rtdb: string[] };

const collectionOf = (p: string) => {
  const parts = p.split("/");
  // competitions/x/trades/y -> competitions/trades; drafts/x -> drafts
  return parts.filter((_, i) => i % 2 === 0).join("/");
};

function writePrivate(file: string, contents: string) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  // Windows ignores POSIX modes; the folder's ACL (a private folder under the
  // user profile) is what protects it there. See docs/castaway-id-mapping.md.
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* not supported */
  }
}

export async function createBackup(
  source: BackupSource,
  scope: BackupScope,
  outDir: string,
  meta: {
    seasonNum: number;
    mappingHash: string;
    toolCommit: string | null;
    now?: Date;
  },
): Promise<{ manifest: BackupManifest; manifestSha256: string }> {
  const refusals = [
    emulatorTargetRefusal(source.env, source.projectId),
    databaseUrlRefusal(source.databaseUrl, source.projectId),
    backupDirRefusal(outDir),
  ].filter((r): r is string => r !== null);
  if (refusals.length > 0) throw new Error(refusals.join("; "));

  const fsDocs = await source.readFirestore(scope.firestore);
  const rtNodes = await source.readRtdb(scope.rtdb);
  const firestore: Record<string, unknown> = {};
  for (const [p, data] of fsDocs) {
    if (data !== null && data !== undefined)
      firestore[p] = encodeFirestoreValue(data, p);
  }
  const rtdb: Record<string, unknown> = {};
  for (const [p, node] of rtNodes) {
    if (node !== null && node !== undefined) rtdb[p] = node;
  }

  const contents: Record<BackupFile, string> = {
    "firestore.json": canonicalJson(firestore),
    "rtdb.json": canonicalJson(rtdb),
  };
  const docHashes: Record<string, string> = {};
  for (const [p, d] of [
    ...Object.entries(firestore),
    ...Object.entries(rtdb),
  ]) {
    docHashes[p] = sha256(canonicalJson(d));
  }
  const byCollection: Record<string, number> = {};
  for (const p of Object.keys(docHashes)) {
    byCollection[collectionOf(p)] = (byCollection[collectionOf(p)] ?? 0) + 1;
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    kind: "castaway_id_remap_backup",
    season_num: meta.seasonNum,
    project_id: source.projectId ?? "",
    database_url: source.databaseUrl ?? "",
    mapping_hash: meta.mappingHash,
    created_at: (meta.now ?? new Date()).toISOString(),
    tool_commit: meta.toolCommit,
    counts: {
      firestore: Object.keys(firestore).length,
      rtdb: Object.keys(rtdb).length,
      by_collection: byCollection,
    },
    files: Object.fromEntries(
      BACKUP_FILES.map((f) => [
        f,
        { bytes: Buffer.byteLength(contents[f]), sha256: sha256(contents[f]) },
      ]),
    ) as BackupManifest["files"],
    doc_hashes: docHashes,
  };

  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const f of BACKUP_FILES) writePrivate(path.join(outDir, f), contents[f]);
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  writePrivate(path.join(outDir, "manifest.json"), manifestJson);

  // It only counts once it reads back exactly as written.
  const check = verifyBackup(outDir);
  if (check.errors.length > 0) {
    throw new Error(`Backup read-back failed: ${check.errors.join("; ")}`);
  }
  return { manifest, manifestSha256: sha256(manifestJson) };
}

export type BackupCheck = {
  errors: string[];
  manifest: BackupManifest | null;
  firestore: Record<string, unknown>;
  rtdb: Record<string, unknown>;
};

/** Read a backup back from disk and check it against its manifest. */
export function verifyBackup(dir: string): BackupCheck {
  const out: BackupCheck = {
    errors: [],
    manifest: null,
    firestore: {},
    rtdb: {},
  };
  const read = (f: string) => {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) {
      out.errors.push(`${f} is missing`);
      return null;
    }
    return fs.readFileSync(file);
  };
  const rawManifest = read("manifest.json");
  if (!rawManifest) return out;
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(rawManifest.toString("utf-8")) as BackupManifest;
  } catch {
    out.errors.push("manifest.json is not JSON");
    return out;
  }
  if (
    manifest.format !== BACKUP_FORMAT ||
    manifest.kind !== "castaway_id_remap_backup"
  ) {
    out.errors.push("manifest.json is not a castaway id remap backup");
    return out;
  }
  out.manifest = manifest;
  const parsed: Partial<Record<BackupFile, Record<string, unknown>>> = {};
  for (const f of BACKUP_FILES) {
    const raw = read(f);
    if (!raw) continue;
    const expect = manifest.files?.[f];
    if (
      !expect ||
      raw.length !== expect.bytes ||
      sha256(raw) !== expect.sha256
    ) {
      out.errors.push(`${f} does not match its checksum`);
      continue;
    }
    parsed[f] = JSON.parse(raw.toString("utf-8")) as Record<string, unknown>;
  }
  // A file that fails its checksum says all there is to say.
  if (out.errors.length > 0) return out;
  out.firestore = parsed["firestore.json"] ?? {};
  out.rtdb = parsed["rtdb.json"] ?? {};
  if (Object.keys(out.firestore).length !== manifest.counts.firestore) {
    out.errors.push("the Firestore document count does not match the manifest");
  }
  if (Object.keys(out.rtdb).length !== manifest.counts.rtdb) {
    out.errors.push("the RTDB node count does not match the manifest");
  }
  const all = { ...out.firestore, ...out.rtdb };
  const hashed = Object.keys(manifest.doc_hashes ?? {});
  if (hashed.length !== Object.keys(all).length) {
    out.errors.push("the manifest does not hash every document");
  }
  const bad = hashed.filter(
    (p) =>
      !(p in all) || sha256(canonicalJson(all[p])) !== manifest.doc_hashes[p],
  );
  if (bad.length > 0)
    out.errors.push(`${bad.length} document(s) do not match their hash`);
  return out;
}

/**
 * Why the cutover must not begin with this backup, or none. The backup must
 * read back cleanly, be of this project, database, season and mapping, be
 * recent, and hold every document the fresh read found: anything missing was
 * created after it, so it would not be restorable.
 */
export function backupRefusals(input: {
  check: BackupCheck;
  project: string;
  databaseUrl: string | null;
  seasonNum: number;
  mappingHash: string;
  now: Date;
  maxAgeHours: number;
  freshPaths: readonly string[];
}): string[] {
  const { check } = input;
  const m = check.manifest;
  if (!m) return [`the backup is unreadable: ${check.errors.join("; ")}`];
  const out = check.errors.map((e) => `backup: ${e}`);
  if (m.project_id !== input.project)
    out.push(`the backup is of ${m.project_id}, not ${input.project}`);
  if (m.database_url !== input.databaseUrl)
    out.push("the backup read another Realtime Database");
  if (m.season_num !== input.seasonNum)
    out.push("the backup is of another season");
  if (m.mapping_hash !== input.mappingHash)
    out.push("the backup was taken under another mapping");
  const age = (input.now.getTime() - Date.parse(m.created_at)) / 3.6e6;
  if (!(age >= 0 && age <= input.maxAgeHours)) {
    out.push(`the backup is ${age.toFixed(1)}h old; take a new one`);
  }
  const held = new Set(Object.keys(m.doc_hashes));
  const missing = input.freshPaths.filter((p) => !held.has(p));
  if (missing.length > 0) {
    out.push(
      `${missing.length} document(s) are not in the backup (created after it); take a new one`,
    );
  }
  return out;
}

export type RestoreTarget = {
  projectId: string | null;
  env: Readonly<Record<string, string | undefined>>;
  writeFirestore(docs: Map<string, unknown>): Promise<void>;
  writeRtdb(nodes: Map<string, unknown>): Promise<void>;
  readFirestore(paths: readonly string[]): Promise<Map<string, unknown | null>>;
  readRtdb(paths: readonly string[]): Promise<Map<string, unknown | null>>;
  makeTimestamp(seconds: number, nanoseconds: number): unknown;
};

/**
 * The restoration drill: write a verified backup into the emulators, read
 * every document back and compare it with the manifest's hash. Refuses any
 * target that is not an emulator of a `demo-` project.
 */
export async function restoreBackupToEmulator(
  target: RestoreTarget,
  dir: string,
): Promise<{ firestore: number; rtdb: number; mismatches: string[] }> {
  const aim = emulatorTargetRefusal(target.env, target.projectId);
  if (aim || !target.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      `Refusing to restore: only the emulators are a restore target${aim ? ` (${aim})` : ""}`,
    );
  }
  const check = verifyBackup(dir);
  if (check.errors.length > 0 || !check.manifest) {
    throw new Error(
      `Refusing to restore an unverified backup: ${check.errors.join("; ")}`,
    );
  }
  await target.writeFirestore(
    new Map(
      Object.entries(check.firestore).map(([p, d]) => [
        p,
        decodeFirestoreValue(d, target.makeTimestamp),
      ]),
    ),
  );
  await target.writeRtdb(new Map(Object.entries(check.rtdb)));

  const mismatches: string[] = [];
  const fsBack = await target.readFirestore(Object.keys(check.firestore));
  for (const [p, d] of fsBack) {
    if (
      d == null ||
      sha256(canonicalJson(encodeFirestoreValue(d, p))) !==
        check.manifest.doc_hashes[p]
    ) {
      mismatches.push(p);
    }
  }
  const rtBack = await target.readRtdb(Object.keys(check.rtdb));
  for (const [p, n] of rtBack) {
    if (n == null || sha256(canonicalJson(n)) !== check.manifest.doc_hashes[p])
      mismatches.push(p);
  }
  return {
    firestore: Object.keys(check.firestore).length,
    rtdb: Object.keys(check.rtdb).length,
    mismatches,
  };
}

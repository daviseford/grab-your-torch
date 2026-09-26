import { Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_MAX_AGE_HOURS,
  backupDirRefusal,
  backupRefusals,
  type BackupSource,
  createBackup,
  decodeFirestoreValue,
  encodeFirestoreValue,
  liveDocumentHashes,
  verifyBackup,
} from "../lib/remap-backup";

const dirs: string[] = [];
const freshDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "remap-backup-test-"));
  dirs.push(d);
  return path.join(d, "backup");
};
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const source = (over: Partial<BackupSource> = {}): BackupSource => ({
  projectId: "survivor-fantasy-51c4b",
  databaseUrl: "https://survivor-fantasy-51c4b-default-rtdb.firebaseio.com",
  env: {},
  readFirestore: async (paths) =>
    new Map(
      paths.map((p) => [
        p,
        p === "admin_migrations/x"
          ? null
          : { castaway_id: "US0754", at: new Timestamp(1_700_000_000, 5) },
      ]),
    ),
  readRtdb: async (paths) =>
    new Map(paths.map((p) => [p, { draft_picks: [null, { id: "US0754" }] }])),
  ...over,
});
const scope = {
  firestore: ["competitions/a", "seasons/season_51", "admin_migrations/x"],
  rtdb: ["drafts/d"],
};
const meta = { seasonNum: 51, mappingHash: "h", toolCommit: "abc" };

describe("encoding", () => {
  it("round-trips timestamps and refuses types it cannot keep", () => {
    const ts = new Timestamp(10, 20);
    const encoded = encodeFirestoreValue({ a: [ts], b: { c: 1 } });
    expect(JSON.parse(JSON.stringify(encoded))).toEqual({
      a: [{ __backup_type: "timestamp", seconds: 10, nanoseconds: 20 }],
      b: { c: 1 },
    });
    const decoded = decodeFirestoreValue(
      JSON.parse(JSON.stringify(encoded)),
      (s, n) => new Timestamp(s, n),
    ) as { a: Timestamp[] };
    expect(decoded.a[0].isEqual(ts)).toBe(true);
    expect(() => encodeFirestoreValue({ x: new Map() })).toThrow(/unsupported/);
    expect(() => encodeFirestoreValue({ x: Infinity })).toThrow(/non-finite/);
    expect(() => encodeFirestoreValue({ __backup_type: "x" })).toThrow(
      /reserved/,
    );
  });
});

describe("the backup folder", () => {
  it("must be absolute, empty and outside any git work tree", () => {
    expect(backupDirRefusal("relative/dir")).toMatch(/absolute/);
    expect(backupDirRefusal(path.resolve(import.meta.dirname))).toMatch(
      /inside the git work tree/,
    );
    const d = freshDir();
    expect(backupDirRefusal(d)).toBeNull();
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "x"), "");
    expect(backupDirRefusal(d)).toMatch(/not empty/);
  });
});

describe("createBackup and verifyBackup", () => {
  it("writes, reads back and verifies; absent documents are left out", async () => {
    const dir = freshDir();
    const { manifest } = await createBackup(source(), scope, dir, meta);
    expect(manifest.counts).toEqual({
      firestore: 2,
      rtdb: 1,
      by_collection: { competitions: 1, seasons: 1, drafts: 1 },
    });
    expect(Object.keys(manifest.doc_hashes).sort()).toEqual([
      "competitions/a",
      "drafts/d",
      "seasons/season_51",
    ]);
    expect(verifyBackup(dir).errors).toEqual([]);
  });

  it("detects a changed or missing file", async () => {
    const dir = freshDir();
    await createBackup(source(), scope, dir, meta);
    fs.appendFileSync(path.join(dir, "rtdb.json"), " ");
    expect(verifyBackup(dir).errors).toContain(
      "rtdb.json does not match its checksum",
    );
    fs.rmSync(path.join(dir, "firestore.json"));
    expect(verifyBackup(dir).errors).toContain("firestore.json is missing");
  });

  it("refuses a cross-targeted or foreign-database source", async () => {
    await expect(
      createBackup(
        source({ env: { FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" } }),
        scope,
        freshDir(),
        meta,
      ),
    ).rejects.toThrow(/only one emulator/);
    await expect(
      createBackup(
        source({ databaseUrl: "https://other-default-rtdb.firebaseio.com" }),
        scope,
        freshDir(),
        meta,
      ),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("backupRefusals", () => {
  it("binds the backup to the target, season, mapping, a fixed age, a private place and the content of every current document", async () => {
    const dir = freshDir();
    const now = new Date("2026-09-26T12:00:00.000Z");
    await createBackup(source(), scope, dir, { ...meta, now });
    const live = await liveDocumentHashes(source(), scope);
    expect([...live.keys()].sort()).toEqual([
      "competitions/a",
      "drafts/d",
      "seasons/season_51",
    ]);
    const base = {
      check: verifyBackup(dir),
      dir,
      project: "survivor-fantasy-51c4b",
      databaseUrl: "https://survivor-fantasy-51c4b-default-rtdb.firebaseio.com",
      seasonNum: 51,
      mappingHash: "h",
      now: new Date("2026-09-26T13:00:00.000Z"),
      liveHashes: live,
    };
    expect(backupRefusals(base)).toEqual([]);
    expect(backupRefusals({ ...base, project: "x" })).toHaveLength(1);
    expect(backupRefusals({ ...base, mappingHash: "other" })).toHaveLength(1);
    // The age limit is fixed, whatever --max-plan-age-hours says.
    expect(BACKUP_MAX_AGE_HOURS).toBe(2);
    expect(
      backupRefusals({ ...base, now: new Date("2026-09-26T14:30:00.000Z") }),
    ).toEqual(["the backup is 2.5h old (at most 2h); take a new one"]);
    // A document created since the backup.
    expect(
      backupRefusals({
        ...base,
        liveHashes: new Map([...live, ["competitions/new", "x"]]),
      }),
    ).toEqual([
      "1 document(s) are not in the backup (created after it); take a new one",
    ]);
    // Same paths, but one document's content moved on.
    const drifted = new Map(live);
    drifted.set("drafts/d", "0".repeat(64));
    expect(backupRefusals({ ...base, liveHashes: drifted })).toEqual([
      "1 document(s) changed since the backup; take a new one",
    ]);
    // A copy inside a git work tree is refused when used, not only when made.
    expect(
      backupRefusals({ ...base, dir: path.resolve(import.meta.dirname) }).join(
        "; ",
      ),
    ).toMatch(/inside the git work tree/);
  });
});

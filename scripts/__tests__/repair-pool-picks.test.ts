import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { CastawayId, PoolPick } from "../../src/types";
import {
  auditPoolPicks,
  loadPoolFromFirestore,
  planPoolPickRepairs,
  readPoolSnapshot,
  type AuditablePoolEntry,
} from "../repair-pool-picks.js";
import {
  POOL_SNAPSHOT_DIR,
  POOL_SNAPSHOT_FILES,
  snapshotPools,
  type ReadableDb,
  type ReadableNode,
} from "../snapshot-firestore.js";

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * The scenario these are built around is the real one (U15 / R23): a
 * Season 51 id remap edits the pool config roster, which retroactively
 * makes already-stored entries disagree. Security rules stop a *client*
 * from ever submitting a mismatched pair, so a mismatch can only be
 * created by a later roster edit.
 * ------------------------------------------------------------------ */

const id = (raw: string) => raw as CastawayId;

/** The provisional roster the pool was created with. */
const PROVISIONAL_ROSTER: PoolPick[] = [
  { castaway_id: id("US0752"), full_name: "Alex Moore" },
  { castaway_id: id("US0753"), full_name: "Bianca Reyes" },
  { castaway_id: id("US0754"), full_name: "Cory Nakamura" },
];

/** The same three people after survivoR published its real ids. */
const REMAPPED_ROSTER: PoolPick[] = [
  { castaway_id: id("US0801"), full_name: "Alex Moore" },
  { castaway_id: id("US0802"), full_name: "Bianca Reyes" },
  { castaway_id: id("US0803"), full_name: "Cory Nakamura" },
];

/**
 * A remap plus a late cast change: US0803 now belongs to somebody else
 * entirely, so a pick for Cory has no name anchor left.
 */
const REMAPPED_WITH_CAST_CHANGE: PoolPick[] = [
  { castaway_id: id("US0801"), full_name: "Alex Moore" },
  { castaway_id: id("US0802"), full_name: "Bianca Reyes" },
  { castaway_id: id("US0803"), full_name: "Dana Whitlock" },
];

const entry = (
  entryId: string,
  picks: PoolPick[],
  handle = entryId,
): AuditablePoolEntry => ({ id: entryId, handle, picks });

/** An entry submitted while the provisional roster was still current. */
const storedOnProvisionalIds = () =>
  entry("uid_alpha", [PROVISIONAL_ROSTER[0], PROVISIONAL_ROSTER[2]]);

/** The same two picks, submitted after the remap landed. */
const storedOnRemappedIds = () =>
  entry("uid_beta", [REMAPPED_ROSTER[0], REMAPPED_ROSTER[2]]);

/* ------------------------------------------------------------------ *
 * auditPoolPicks
 * ------------------------------------------------------------------ */

describe("auditPoolPicks", () => {
  it("reports nothing for entries that agree with the roster", () => {
    const result = auditPoolPicks(REMAPPED_ROSTER, [storedOnRemappedIds()]);

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.unrepairable).toEqual([]);
    expect(result.roster_name_collisions).toEqual([]);
    expect(result.entries_checked).toBe(1);
    expect(result.picks_checked).toBe(2);
    expect(result.consistent).toBe(2);
  });

  it("reports every pick a remap left behind, with the roster pair to repair to", () => {
    const result = auditPoolPicks(REMAPPED_ROSTER, [storedOnProvisionalIds()]);

    expect(result.ok).toBe(false);
    expect(result.unrepairable).toEqual([]);
    expect(result.consistent).toBe(0);
    expect(result.mismatches).toEqual([
      {
        entry_id: "uid_alpha",
        handle: "uid_alpha",
        pick_index: 0,
        stored: { castaway_id: "US0752", full_name: "Alex Moore" },
        roster: { castaway_id: "US0801", full_name: "Alex Moore" },
      },
      {
        entry_id: "uid_alpha",
        handle: "uid_alpha",
        pick_index: 1,
        stored: { castaway_id: "US0754", full_name: "Cory Nakamura" },
        roster: { castaway_id: "US0803", full_name: "Cory Nakamura" },
      },
    ]);
  });

  it("reports only the entry that disagrees, not its consistent neighbours", () => {
    const result = auditPoolPicks(REMAPPED_ROSTER, [
      storedOnRemappedIds(),
      storedOnProvisionalIds(),
    ]);

    expect(result.mismatches.map((m) => m.entry_id)).toEqual([
      "uid_alpha",
      "uid_alpha",
    ]);
    expect(result.consistent).toBe(2);
    expect(result.picks_checked).toBe(4);
  });

  it("reports a pick whose name is on no roster entry as unrepairable rather than guessing", () => {
    const result = auditPoolPicks(REMAPPED_WITH_CAST_CHANGE, [
      storedOnProvisionalIds(),
    ]);

    expect(result.ok).toBe(false);
    // Alex is still on the roster under a new id, so that pick is repairable.
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].stored.full_name).toBe("Alex Moore");

    expect(result.unrepairable).toHaveLength(1);
    const problem = result.unrepairable[0];
    expect(problem.entry_id).toBe("uid_alpha");
    expect(problem.pick_index).toBe(1);
    expect(problem.stored).toEqual({
      castaway_id: "US0754",
      full_name: "Cory Nakamura",
    });
    expect(problem.reason).toBe("name_not_on_roster");
  });

  it("names the person a reused id now points at, so misattribution is visible", () => {
    const result = auditPoolPicks(REMAPPED_WITH_CAST_CHANGE, [
      // This entrant already carries the post-remap id for Cory. The id
      // survived the remap but now belongs to Dana, which is exactly the
      // silent misattribution R23 exists to prevent.
      entry("uid_gamma", [
        { castaway_id: id("US0803"), full_name: "Cory Nakamura" },
      ]),
    ]);

    expect(result.unrepairable).toHaveLength(1);
    expect(result.unrepairable[0].reason).toBe("name_not_on_roster");
    expect(result.unrepairable[0].detail).toContain("Dana Whitlock");
  });

  it("treats a whitespace or capitalization drift as repairable, not as a different person", () => {
    const result = auditPoolPicks(REMAPPED_ROSTER, [
      entry("uid_delta", [
        { castaway_id: id("US0752"), full_name: "  alex   moore " },
      ]),
    ]);

    expect(result.unrepairable).toEqual([]);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].roster).toEqual({
      castaway_id: "US0801",
      full_name: "Alex Moore",
    });
  });

  it("refuses to repair by name when the roster has two people with the same name", () => {
    const collidingRoster: PoolPick[] = [
      { castaway_id: id("US0801"), full_name: "Alex Moore" },
      { castaway_id: id("US0899"), full_name: "Alex Moore" },
    ];

    const result = auditPoolPicks(collidingRoster, [
      entry("uid_eps", [
        { castaway_id: id("US0752"), full_name: "Alex Moore" },
      ]),
    ]);

    expect(result.roster_name_collisions).toEqual(["Alex Moore"]);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([]);
    expect(result.unrepairable).toHaveLength(1);
    expect(result.unrepairable[0].reason).toBe("ambiguous_name");
  });

  it("fails the audit for a colliding roster even when no pick uses the name", () => {
    const collidingRoster: PoolPick[] = [
      { castaway_id: id("US0801"), full_name: "Alex Moore" },
      { castaway_id: id("US0899"), full_name: "Alex Moore" },
      { castaway_id: id("US0802"), full_name: "Bianca Reyes" },
    ];

    const result = auditPoolPicks(collidingRoster, [
      entry("uid_zeta", [
        { castaway_id: id("US0802"), full_name: "Bianca Reyes" },
      ]),
    ]);

    expect(result.unrepairable).toEqual([]);
    expect(result.roster_name_collisions).toEqual(["Alex Moore"]);
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * planPoolPickRepairs
 * ------------------------------------------------------------------ */

describe("planPoolPickRepairs", () => {
  it("rewrites a mismatched pick by name and leaves consistent picks untouched", () => {
    const plan = planPoolPickRepairs(REMAPPED_ROSTER, [
      entry("uid_alpha", [
        { castaway_id: id("US0801"), full_name: "Alex Moore" },
        { castaway_id: id("US0754"), full_name: "Cory Nakamura" },
      ]),
    ]);

    expect(plan.blocked).toEqual([]);
    expect(plan.repairs).toHaveLength(1);

    const repair = plan.repairs[0];
    expect(repair.entry_id).toBe("uid_alpha");
    expect(repair.picks).toEqual([
      { castaway_id: "US0801", full_name: "Alex Moore" },
      { castaway_id: "US0803", full_name: "Cory Nakamura" },
    ]);
    expect(repair.changes).toEqual([
      {
        pick_index: 1,
        from: { castaway_id: "US0754", full_name: "Cory Nakamura" },
        to: { castaway_id: "US0803", full_name: "Cory Nakamura" },
      },
    ]);
  });

  it("plans no write for an entry that already agrees with the roster", () => {
    const plan = planPoolPickRepairs(REMAPPED_ROSTER, [storedOnRemappedIds()]);

    expect(plan.repairs).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.audit.ok).toBe(true);
  });

  it("refuses to partially repair an entry that holds an unrepairable pick", () => {
    const plan = planPoolPickRepairs(REMAPPED_WITH_CAST_CHANGE, [
      storedOnProvisionalIds(),
    ]);

    // Alex could be repaired, but Cory cannot, so the whole entry is left
    // alone: a half-written entry would hide the problem from the operator.
    expect(plan.repairs).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].entry_id).toBe("uid_alpha");
  });

  it("repairs the healthy entries in a pool that also holds a blocked one", () => {
    const plan = planPoolPickRepairs(REMAPPED_WITH_CAST_CHANGE, [
      storedOnProvisionalIds(),
      entry("uid_theta", [
        { castaway_id: id("US0753"), full_name: "Bianca Reyes" },
      ]),
    ]);

    expect(plan.repairs.map((r) => r.entry_id)).toEqual(["uid_theta"]);
    expect(plan.blocked.map((b) => b.entry_id)).toEqual(["uid_alpha"]);
  });
});

/* ------------------------------------------------------------------ *
 * The snapshot pool walk
 * ------------------------------------------------------------------ */

const POOL_ID = "pool_season_51";

const poolTree = (): ReadableNode => ({
  pools: {
    [POOL_ID]: {
      __data: {
        id: POOL_ID,
        season_num: 51,
        roster: REMAPPED_ROSTER,
        picks_per_entry: 1,
      },
      meta: {
        counters: { __data: { entry_count: 2, updated_at: "2026-09-24" } },
      },
      entries: {
        uid_alpha: {
          __data: {
            id: "pool_entry_uid_alpha",
            handle: "alpha",
            picks: [{ castaway_id: "US0801", full_name: "Alex Moore" }],
          },
        },
        uid_beta: {
          __data: {
            id: "pool_entry_uid_beta",
            handle: "beta",
            picks: [{ castaway_id: "US0803", full_name: "Cory Nakamura" }],
          },
        },
      },
      standings: {
        episode_1: {
          __data: { episode_num: 1, entry_count: 2, page_count: 1, rows: [] },
          pages: {
            "0": { __data: { page: 0, rows: [{ handle: "beta", rank: 2 }] } },
          },
        },
      },
    },
  },
});

/** A read-only stand-in for the Admin Firestore surface snapshotPools uses. */
const fakeDb = (root: ReadableNode): ReadableDb => {
  const collection = (parent: ReadableNode, name: string) => {
    const raw = (parent[name] ?? {}) as Record<string, ReadableNode>;
    const snap = (docId: string, node: ReadableNode) => ({
      id: docId,
      exists: node.__data !== undefined,
      data: () => node.__data,
    });
    return {
      get: async () => ({
        docs: Object.entries(raw).map(([docId, node]) => snap(docId, node)),
      }),
      doc: (docId: string) => {
        const node = (raw[docId] ?? {}) as ReadableNode;
        return {
          get: async () => snap(docId, node),
          collection: (child: string) => collection(node, child),
        };
      },
    };
  };
  return { collection: (name: string) => collection(root, name) };
};

const tempDirs: string[] = [];
const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pool-snapshot-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const readJson = (...parts: string[]) =>
  JSON.parse(fs.readFileSync(path.join(...parts), "utf-8"));

describe("snapshotPools", () => {
  it("captures the config, counters, entries, and standings of every pool", async () => {
    const outDir = makeTempDir();
    const summaries = await snapshotPools(fakeDb(poolTree()), outDir);

    expect(summaries).toEqual([
      { pool_id: POOL_ID, entries: 2, standings: 1, standings_pages: 1 },
    ]);

    const dir = path.join(outDir, POOL_SNAPSHOT_DIR, POOL_ID);
    expect(readJson(dir, POOL_SNAPSHOT_FILES.config).season_num).toBe(51);
    expect(readJson(dir, POOL_SNAPSHOT_FILES.counters).entry_count).toBe(2);

    const entries = readJson(dir, POOL_SNAPSHOT_FILES.entries);
    expect(Object.keys(entries).sort()).toEqual(["uid_alpha", "uid_beta"]);
    expect(entries.uid_beta.handle).toBe("beta");
  });

  it("captures an overflow standings page, which the per-season loop would miss", async () => {
    const outDir = makeTempDir();
    await snapshotPools(fakeDb(poolTree()), outDir);

    const standings = readJson(
      outDir,
      POOL_SNAPSHOT_DIR,
      POOL_ID,
      POOL_SNAPSHOT_FILES.standings,
    );

    expect(standings.episode_1.doc.page_count).toBe(1);
    expect(standings.episode_1.pages["0"].rows).toEqual([
      { handle: "beta", rank: 2 },
    ]);
  });

  it("writes nothing and reports nothing when there are no pools", async () => {
    const outDir = makeTempDir();
    const summaries = await snapshotPools(fakeDb({}), outDir);

    expect(summaries).toEqual([]);
    expect(fs.existsSync(path.join(outDir, POOL_SNAPSHOT_DIR))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The snapshot is what the audit reads
 * ------------------------------------------------------------------ */

describe("readPoolSnapshot", () => {
  it("audits a seeded pool snapshot clean", async () => {
    const outDir = makeTempDir();
    await snapshotPools(fakeDb(poolTree()), outDir);

    const { pool, entries } = readPoolSnapshot(
      path.join(outDir, POOL_SNAPSHOT_DIR, POOL_ID),
    );

    expect(entries).toHaveLength(2);
    expect(auditPoolPicks(pool.roster, entries).ok).toBe(true);
  });

  it("reports a deliberate id swap made to the snapshotted config", async () => {
    const outDir = makeTempDir();
    await snapshotPools(fakeDb(poolTree()), outDir);

    const dir = path.join(outDir, POOL_SNAPSHOT_DIR, POOL_ID);
    const configPath = path.join(dir, POOL_SNAPSHOT_FILES.config);
    const config = readJson(dir, POOL_SNAPSHOT_FILES.config);
    // Swap the two ids, exactly as a bad remap would.
    config.roster = [
      { castaway_id: "US0803", full_name: "Alex Moore" },
      { castaway_id: "US0802", full_name: "Bianca Reyes" },
      { castaway_id: "US0801", full_name: "Cory Nakamura" },
    ];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const { pool, entries } = readPoolSnapshot(dir);
    const audit = auditPoolPicks(pool.roster, entries);

    expect(audit.ok).toBe(false);
    expect(audit.mismatches).toHaveLength(2);

    const plan = planPoolPickRepairs(pool.roster, entries);
    expect(plan.blocked).toEqual([]);
    expect(plan.repairs).toHaveLength(2);
    expect(
      planPoolPickRepairs(
        pool.roster,
        plan.repairs.map((r) => ({ id: r.entry_id, picks: r.picks })),
      ).audit.ok,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The live read path, exercised without Firebase
 * ------------------------------------------------------------------ */

describe("loadPoolFromFirestore", () => {
  it("reads the config roster and every entry document", async () => {
    const { pool, entries } = await loadPoolFromFirestore(
      fakeDb(poolTree()),
      POOL_ID,
    );

    expect(pool.roster).toHaveLength(3);
    expect(entries.map((e) => e.id).sort()).toEqual(["uid_alpha", "uid_beta"]);
    expect(auditPoolPicks(pool.roster, entries).ok).toBe(true);
  });

  it("throws when the pool document does not exist", async () => {
    await expect(loadPoolFromFirestore(fakeDb({}), POOL_ID)).rejects.toThrow(
      /pool_season_51/,
    );
  });
});

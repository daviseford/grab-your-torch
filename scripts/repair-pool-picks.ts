/**
 * Audit and repair stored pool picks against the pool configuration roster.
 *
 * Season 51's castaway ids (US0752 to US0772) are provisional predictions
 * made before survivoR published, so a remap is certain rather than
 * hypothetical. A remap is a manual code edit and it does not migrate entry
 * documents: the config roster is updated first, and every already-stored
 * entry then disagrees with it. Security rules validate a pick as a whole
 * `{castaway_id, full_name}` pair deep-equal to a roster element, so a
 * *client* can never submit a mismatched pair. Every mismatch this script
 * finds was therefore created by a later roster edit, which is exactly the
 * case R23 stores the name for.
 *
 * The pool config roster is authoritative for pool picks, and stays so. The
 * season document is not consulted here: Season 51 is deliberately not in
 * Firestore, so the config roster is the only cast source there is (KTD3).
 * Repairs rewrite entries by name against the config; the season document
 * never rewrites a pick directly.
 *
 * Dry run by default. Nothing is written unless `--write` is passed, and
 * `--snapshot` audits a local backup without touching Firebase at all.
 *
 * Usage:
 *   yarn repair-pool-picks 51                                  # audit, live read
 *   yarn repair-pool-picks pool_season_51                      # same, by pool id
 *   yarn repair-pool-picks 51 --snapshot data/firestore-snapshots/<ts>
 *   yarn repair-pool-picks 51 --write                           # apply repairs
 */

import * as fs from "fs";
import * as path from "path";
import type { CastawayId, Pool, PoolPick } from "../src/types";
import {
  POOL_SNAPSHOT_DIR,
  POOL_SNAPSHOT_FILES,
  type ReadableDb,
} from "./snapshot-firestore.js";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/**
 * One entry, reduced to what the audit needs.
 *
 * `id` is the entry *document* id, which is the entrant's uid. It is what an
 * operator needs to find the document again, so it is what gets reported.
 */
export type AuditablePoolEntry = {
  id: string;
  handle?: string;
  picks: readonly PoolPick[];
};

/**
 * A pick that is repairable: its name resolves to exactly one roster entry,
 * but the stored pair is not that roster entry.
 */
export type PoolPickMismatch = {
  entry_id: string;
  handle?: string;
  pick_index: number;
  stored: PoolPick;
  /** The roster element the stored name resolves to, and the repair target. */
  roster: PoolPick;
};

export type UnrepairableReason =
  /** The stored name matches no roster entry, so there is nothing to repair to. */
  | "name_not_on_roster"
  /** Two roster entries share the name, so repairing by name would be a guess. */
  | "ambiguous_name";

export type PoolPickProblem = {
  entry_id: string;
  handle?: string;
  pick_index: number;
  stored: PoolPick;
  reason: UnrepairableReason;
  /** Printable explanation, including who the stored id refers to now. */
  detail: string;
};

export type PoolPickAudit = {
  /** True only when nothing at all needs an operator's attention. */
  ok: boolean;
  entries_checked: number;
  picks_checked: number;
  /** Picks that are already deep-equal to a roster element. */
  consistent: number;
  /** Repairable by name. Ship the repair in the same change as the id edit. */
  mismatches: PoolPickMismatch[];
  /** Not repairable by name. A human has to decide what these should be. */
  unrepairable: PoolPickProblem[];
  /**
   * Names held by more than one roster entry. Repair by name is not sound
   * for such a pool even if no pick currently uses the name, so this fails
   * the audit on its own.
   */
  roster_name_collisions: string[];
};

export type PoolPickChange = {
  pick_index: number;
  from: PoolPick;
  to: PoolPick;
};

export type PoolEntryRepair = {
  entry_id: string;
  handle?: string;
  /** The full picks array to write, repaired picks included. */
  picks: PoolPick[];
  changes: PoolPickChange[];
};

export type PoolPickRepairPlan = {
  audit: PoolPickAudit;
  /** Entries with at least one change and no unrepairable pick. */
  repairs: PoolEntryRepair[];
  /**
   * Problems that stop an entry being written. An entry appearing here is
   * left completely alone, repairable picks included: a half-repaired entry
   * looks healthy on the next run and hides the part a human must fix.
   */
  blocked: PoolPickProblem[];
};

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * Names are compared with case and surrounding whitespace ignored.
 *
 * A remap changes ids, not people, so the name is the stable identity. Being
 * stricter than this would turn a capitalization fix in the roster into a
 * blocking "unrepairable" report, and an operator who sees noise learns to
 * override the audit. A genuine name change still fails to match and is
 * still reported loudly.
 */
export const normalizePickName = (name: string): string =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

const samePick = (a: PoolPick, b: PoolPick): boolean =>
  a.castaway_id === b.castaway_id && a.full_name === b.full_name;

type RosterIndex = {
  byName: Map<string, PoolPick[]>;
  byId: Map<CastawayId, PoolPick>;
  collisions: string[];
};

const indexRoster = (roster: readonly PoolPick[]): RosterIndex => {
  const byName = new Map<string, PoolPick[]>();
  const byId = new Map<CastawayId, PoolPick>();

  for (const member of roster) {
    const key = normalizePickName(member.full_name);
    byName.set(key, [...(byName.get(key) ?? []), member]);
    byId.set(member.castaway_id, member);
  }

  const collisions = [...byName.values()]
    .filter((group) => group.length > 1)
    .map((group) => group[0].full_name);

  return { byName, byId, collisions };
};

const describeStoredId = (index: RosterIndex, stored: PoolPick): string => {
  const holder = index.byId.get(stored.castaway_id);
  if (!holder) {
    return `id ${stored.castaway_id} is not on the roster at all`;
  }
  return `id ${stored.castaway_id} now belongs to ${holder.full_name}`;
};

/* ------------------------------------------------------------------ *
 * The audit (R23)
 * ------------------------------------------------------------------ */

/**
 * Compare every stored pick against the pool config roster.
 *
 * Reusable on purpose: the recompute job imports this and refuses to publish
 * standings while any pick is unrepairable. An entrant whose pick cannot be
 * matched would otherwise score zero on that castaway all season, on a public
 * leaderboard, with no recourse.
 */
export const auditPoolPicks = (
  roster: readonly PoolPick[],
  entries: readonly AuditablePoolEntry[],
): PoolPickAudit => {
  const index = indexRoster(roster);

  const mismatches: PoolPickMismatch[] = [];
  const unrepairable: PoolPickProblem[] = [];
  let picksChecked = 0;
  let consistent = 0;

  for (const entry of entries) {
    for (const [pick_index, stored] of entry.picks.entries()) {
      picksChecked += 1;
      const where = { entry_id: entry.id, handle: entry.handle, pick_index };
      const candidates = index.byName.get(normalizePickName(stored.full_name));

      if (!candidates || candidates.length === 0) {
        unrepairable.push({
          ...where,
          stored,
          reason: "name_not_on_roster",
          detail:
            `"${stored.full_name}" is on no roster entry, and ` +
            `${describeStoredId(index, stored)}`,
        });
        continue;
      }

      if (candidates.length > 1) {
        unrepairable.push({
          ...where,
          stored,
          reason: "ambiguous_name",
          detail:
            `"${stored.full_name}" is held by ${candidates.length} roster ` +
            `entries (${candidates.map((c) => c.castaway_id).join(", ")})`,
        });
        continue;
      }

      const target = candidates[0];
      if (samePick(stored, target)) {
        consistent += 1;
      } else {
        mismatches.push({ ...where, stored, roster: target });
      }
    }
  }

  return {
    ok:
      mismatches.length === 0 &&
      unrepairable.length === 0 &&
      index.collisions.length === 0,
    entries_checked: entries.length,
    picks_checked: picksChecked,
    consistent,
    mismatches,
    unrepairable,
    roster_name_collisions: index.collisions,
  };
};

/* ------------------------------------------------------------------ *
 * The repair
 * ------------------------------------------------------------------ */

/**
 * Turn an audit into the writes that would fix it, without performing them.
 *
 * Repair is by name in one direction only: the roster's `castaway_id` and
 * exact spelling replace the stored pair. The reverse, trusting the stored
 * id and rewriting the name, is what silently misattributes points.
 */
export const planPoolPickRepairs = (
  roster: readonly PoolPick[],
  entries: readonly AuditablePoolEntry[],
): PoolPickRepairPlan => {
  const audit = auditPoolPicks(roster, entries);
  const index = indexRoster(roster);

  const blockedEntryIds = new Set(audit.unrepairable.map((p) => p.entry_id));
  const repairs: PoolEntryRepair[] = [];

  for (const entry of entries) {
    if (blockedEntryIds.has(entry.id)) continue;

    const changes: PoolPickChange[] = [];
    const picks = entry.picks.map((stored, pick_index) => {
      const target = index.byName.get(normalizePickName(stored.full_name))?.[0];
      if (!target || samePick(stored, target)) return { ...stored };

      changes.push({ pick_index, from: stored, to: { ...target } });
      return { ...target };
    });

    if (changes.length > 0) {
      repairs.push({
        entry_id: entry.id,
        handle: entry.handle,
        picks,
        changes,
      });
    }
  }

  return { audit, repairs, blocked: audit.unrepairable };
};

/* ------------------------------------------------------------------ *
 * Loading a pool
 * ------------------------------------------------------------------ */

export type LoadedPool = {
  pool: Pick<Pool, "id" | "roster">;
  entries: AuditablePoolEntry[];
};

type StoredEntryShape = { handle?: string; picks?: PoolPick[] };

const toAuditable = (
  id: string,
  data: StoredEntryShape,
): AuditablePoolEntry => ({
  id,
  handle: data.handle,
  picks: data.picks ?? [],
});

/**
 * Read a pool out of a `scripts/snapshot-firestore.ts` backup.
 *
 * Auditing a snapshot is how the audit gets exercised without a production
 * read, and it is also how a pool that has already been damaged gets
 * inspected against the roster it was created with.
 */
export const readPoolSnapshot = (dir: string): LoadedPool => {
  const readFile = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));

  const pool = readFile(POOL_SNAPSHOT_FILES.config) as Pick<
    Pool,
    "id" | "roster"
  >;
  const entries = readFile(POOL_SNAPSHOT_FILES.entries) as Record<
    string,
    StoredEntryShape
  >;

  return {
    pool,
    entries: Object.entries(entries).map(([id, data]) => toAuditable(id, data)),
  };
};

/** Read a pool live. Read-only: the interface has no write member. */
export const loadPoolFromFirestore = async (
  db: ReadableDb,
  poolId: string,
): Promise<LoadedPool> => {
  const poolRef = db.collection("pools").doc(poolId);
  const poolDoc = await poolRef.get();

  if (!poolDoc.exists) {
    throw new Error(`No pool configuration document at pools/${poolId}.`);
  }

  const entries = (await poolRef.collection("entries").get()).docs
    .filter((doc) => doc.exists)
    .map((doc) => toAuditable(doc.id, doc.data() as StoredEntryShape));

  return { pool: poolDoc.data() as Pick<Pool, "id" | "roster">, entries };
};

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

export const describeAudit = (audit: PoolPickAudit): string[] => {
  const lines: string[] = [];

  lines.push(
    `  Entries checked: ${audit.entries_checked}`,
    `  Picks checked:   ${audit.picks_checked}`,
    `  Consistent:      ${audit.consistent}`,
    `  Mismatched:      ${audit.mismatches.length}`,
    `  Unrepairable:    ${audit.unrepairable.length}`,
  );

  if (audit.roster_name_collisions.length > 0) {
    lines.push(
      "",
      "  Roster name collisions (repair by name is not sound here):",
      ...audit.roster_name_collisions.map((name) => `    ${name}`),
    );
  }

  if (audit.mismatches.length > 0) {
    lines.push("", "  Mismatched picks, repairable by name:");
    for (const m of audit.mismatches) {
      lines.push(
        `    ${m.entry_id} [${m.pick_index}] ${m.stored.full_name}: ` +
          `${m.stored.castaway_id} should be ${m.roster.castaway_id}`,
      );
    }
  }

  if (audit.unrepairable.length > 0) {
    lines.push("", "  Unrepairable picks, needing a human decision:");
    for (const p of audit.unrepairable) {
      lines.push(
        `    ${p.entry_id} [${p.pick_index}] (${p.reason}): ${p.detail}`,
      );
    }
  }

  return lines;
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export const poolIdFromArg = (arg: string): string =>
  /^\d+$/.test(arg) ? `pool_season_${arg}` : arg;

const count = (n: number, singular: string, plural = `${singular}s`): string =>
  `${n} ${n === 1 ? singular : plural}`;

export type Args = {
  poolId: string | null;
  snapshotDir: string | null;
  write: boolean;
};

export const parseArgs = (argv: readonly string[]): Args => {
  const parsed: Args = { poolId: null, snapshotDir: null, write: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--dry-run") parsed.write = false;
    else if (arg === "--snapshot") {
      i += 1;
      parsed.snapshotDir = argv[i] ?? null;
    } else if (!arg.startsWith("--")) {
      parsed.poolId = poolIdFromArg(arg);
    }
  }

  return parsed;
};

/**
 * A `--snapshot` argument may point at a snapshot root or at the pool
 * directory inside it. Accept both, because an operator has just been
 * looking at the root.
 */
export const resolveSnapshotPoolDir = (
  snapshotDir: string,
  poolId: string,
): string => {
  const nested = path.join(snapshotDir, POOL_SNAPSHOT_DIR, poolId);
  return fs.existsSync(nested) ? nested : snapshotDir;
};

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

async function main(): Promise<void> {
  const { poolId, snapshotDir, write } = parseArgs(process.argv.slice(2));

  if (poolId === null) {
    fail(
      "no pool given. Usage: yarn repair-pool-picks <season|poolId> [--snapshot <dir>] [--write]",
    );
    return;
  }

  if (snapshotDir && write) {
    fail(
      "--snapshot and --write cannot be combined. A snapshot is a backup, not the live pool",
    );
    return;
  }

  let loaded: LoadedPool;

  if (snapshotDir) {
    console.log(`Auditing ${poolId} from the snapshot at ${snapshotDir}.`);
    loaded = readPoolSnapshot(resolveSnapshotPoolDir(snapshotDir, poolId));
  } else {
    // The Admin SDK is loaded only when a live read is actually needed:
    // importing it initializes the app and requires firebase-private-key.json.
    const { adminApp } = await import("./lib/admin.js");
    const { getFirestore } = await import("firebase-admin/firestore");
    console.log(`Firebase project: ${adminApp.options.projectId}`);
    console.log(`Auditing ${poolId} against its configuration roster.`);
    loaded = await loadPoolFromFirestore(
      getFirestore() as unknown as ReadableDb,
      poolId,
    );
  }

  const plan = planPoolPickRepairs(loaded.pool.roster ?? [], loaded.entries);

  console.log("");
  for (const line of describeAudit(plan.audit)) console.log(line);
  console.log("");

  if (plan.audit.ok) {
    console.log("Audit clean. Every stored pick agrees with the roster.");
    return;
  }

  if (plan.repairs.length > 0) {
    console.log(
      `Repairs planned for ${count(plan.repairs.length, "entry", "entries")}:`,
    );
    for (const repair of plan.repairs) {
      for (const change of repair.changes) {
        console.log(
          `  ${repair.entry_id} [${change.pick_index}] ` +
            `${change.from.castaway_id} "${change.from.full_name}" -> ` +
            `${change.to.castaway_id} "${change.to.full_name}"`,
        );
      }
    }
    console.log("");
  }

  if (plan.blocked.length > 0) {
    console.log(
      `${count(plan.blocked.length, "pick")} cannot be repaired by name. Every ` +
        `entry holding one is left untouched, its repairable picks included, ` +
        `so that nothing looks healthy on the next run while a pick is wrong.`,
    );
    console.log(
      "Fix the roster, or decide by hand what those picks should be, then re-run.",
    );
    console.log("");
  }

  if (!write) {
    console.log(
      "[DRY RUN] Nothing was written. Re-run with --write to apply the repairs.",
    );
    return;
  }

  if (plan.repairs.length === 0) {
    console.log("Nothing to write.");
    return;
  }

  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const db = getFirestore();
  const batch = db.batch();

  for (const repair of plan.repairs) {
    batch.update(db.doc(`pools/${poolId}/entries/${repair.entry_id}`), {
      picks: repair.picks,
      updated_at: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  console.log(
    `Repaired ${count(plan.repairs.length, "entry", "entries")} in pools/${poolId}.`,
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
      console.error("Pool pick audit failed:", err);
      process.exit(1);
    });
}

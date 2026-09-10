/**
 * Provision the public season pool configuration document.
 *
 * No client may write `pools/{poolId}` -- admin claim included (KTD3) -- so
 * this script is the only way the document comes into existence. It turns
 * `SEASON_METADATA.premiere` into the stored `freeze_at` that every runtime
 * surface then reads (R11), and seeds the sibling counters document so the
 * entrant count is present for the whole pre-premiere window rather than
 * appearing only after the recompute job first runs.
 *
 * Dry run by default. Nothing is written to Firestore unless `--write` is
 * passed, and in dry-run mode the Firebase Admin SDK is never even loaded.
 *
 * Usage:
 *   yarn create-pool 51                       # dry run, prints the document
 *   yarn create-pool 51 --write               # create it for real
 *   yarn create-pool 51 --write --overwrite   # replace an existing pool
 */

import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { PropBetQuestionKey } from "../src/data/propbets";
import { PropBetQuestionKeys } from "../src/data/propbets";
import type { SeasonMeta } from "../src/data/season-metadata";
import { SEASON_METADATA } from "../src/data/season-metadata";
import type {
  CastawayId,
  FirestoreTimestamp,
  Pool,
  PoolCounters,
  PoolId,
  PoolPick,
  Season,
} from "../src/types";
import { getSeasonAirStatus } from "../src/utils/seasonAirStatus";

/* ------------------------------------------------------------------ *
 * The freeze instant (KTD9)
 * ------------------------------------------------------------------ */

/**
 * The pool freezes at 8:00 PM Eastern on the premiere date.
 *
 * Survivor airs 8/7c, so a Pacific cutoff (what src/utils/episodeAirDate.ts
 * uses, for a different purpose) would let Eastern viewers enter having
 * already watched the premiere, and a date-granularity cutoff (what
 * src/utils/seasonAirStatus.ts uses) would close roughly twenty hours early.
 *
 * This is an assumption rather than a settled decision. Changing it edits one
 * stored value, so it lives here as two constants and nowhere else.
 */
export const POOL_FREEZE_TIME_ZONE = "America/New_York";
export const POOL_FREEZE_HOUR = 20;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: POOL_FREEZE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const easternDisplayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: POOL_FREEZE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

const readParts = (
  formatter: Intl.DateTimeFormat,
  date: Date,
): Record<string, string> =>
  Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

/**
 * How far the zone sits from UTC at a given instant, in milliseconds.
 *
 * Derived from the instant rather than hardcoded, because Eastern is UTC-4
 * for a September premiere and UTC-5 for a February one.
 */
const zoneOffsetMs = (instant: Date): number => {
  const p = readParts(zonedPartsFormatter, instant);
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asIfUtc - instant.getTime();
};

/**
 * The UTC instant of 8:00 PM Eastern on an ISO premiere date.
 *
 * Solved iteratively: guess with the offset that applies at the naive UTC
 * reading, then re-derive the offset at the resulting instant so a premiere
 * on either side of a daylight-saving switch lands correctly.
 */
export const computeFreezeInstant = (premiere: string): Date => {
  if (!ISO_DATE.test(premiere)) {
    throw new Error(
      `Premiere date must be an ISO date (YYYY-MM-DD), got "${premiere}".`,
    );
  }

  const [year, month, day] = premiere.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, POOL_FREEZE_HOUR, 0, 0);

  let instant = wallClockAsUtc - zoneOffsetMs(new Date(wallClockAsUtc));
  instant = wallClockAsUtc - zoneOffsetMs(new Date(instant));

  return new Date(instant);
};

/** "2026-09-23 20:00 EDT" */
export const formatFreezeInEastern = (instant: Date): string => {
  const p = readParts(easternDisplayFormatter, instant);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
};

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Pools exist only for upcoming seasons (KD3). A pool on an aired season is
 * a quiz, not a prediction.
 */
export const checkSeasonEligible = (
  meta: Pick<SeasonMeta, "complete" | "premiere"> & { name?: string },
  now: Date = new Date(),
): GuardResult => {
  const status = getSeasonAirStatus(meta, now);

  if (status === "complete") {
    return {
      ok: false,
      reason:
        "that season is complete, and a pool only runs on an upcoming season",
    };
  }
  if (!meta.premiere) {
    return {
      ok: false,
      reason:
        "that season has no premiere date in src/data/season-metadata.ts, so there is no freeze instant to store",
    };
  }
  if (status === "live") {
    return {
      ok: false,
      reason:
        "that season is already live, and a pool only runs on an upcoming season",
    };
  }

  return { ok: true };
};

export const checkOverwriteAllowed = (
  poolExists: boolean,
  overwrite: boolean,
): GuardResult =>
  poolExists && !overwrite
    ? {
        ok: false,
        reason:
          "a pool already exists for that season. Pass --overwrite to replace it, which resets the stored freeze instant",
      }
    : { ok: true };

/* ------------------------------------------------------------------ *
 * Document construction
 * ------------------------------------------------------------------ */

export const poolIdForSeason = (seasonNum: number): PoolId =>
  `pool_season_${seasonNum}`;

export type RosterInput = { castaway_id: CastawayId; full_name: string };

export type BuildPoolDocumentInput = {
  seasonNum: number;
  seasonName: string;
  premiere: string;
  players: readonly RosterInput[];
  propBetKeys?: readonly PropBetQuestionKey[];
  /**
   * Injected so the pure builder stays testable without the Admin SDK. The
   * default produces a real Firestore `Timestamp`, which is what rules must
   * compare against `request.time` (KTD4).
   */
  toTimestamp?: (date: Date) => FirestoreTimestamp;
};

const buildRoster = (players: readonly RosterInput[]): PoolPick[] => {
  if (players.length === 0) {
    throw new Error("Cannot build a pool with an empty roster.");
  }

  const roster = players
    .map((p) => {
      if (!p.full_name || p.full_name.trim().length === 0) {
        throw new Error(`Castaway ${p.castaway_id} has no full_name.`);
      }
      return { castaway_id: p.castaway_id, full_name: p.full_name.trim() };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const ids = new Set(roster.map((r) => r.castaway_id));
  if (ids.size !== roster.length) {
    throw new Error("Roster contains duplicate castaway ids.");
  }

  return roster;
};

export const buildPoolDocument = ({
  seasonNum,
  seasonName,
  premiere,
  players,
  propBetKeys = PropBetQuestionKeys,
  toTimestamp = (date) => Timestamp.fromDate(date),
}: BuildPoolDocumentInput): Pool => {
  const roster = buildRoster(players);

  return {
    id: poolIdForSeason(seasonNum),
    season_id: `season_${seasonNum}` as Season["id"],
    season_num: seasonNum,
    name: `${seasonName} Season Pool`,
    freeze_at: toTimestamp(computeFreezeInstant(premiere)),
    roster,
    picks_per_entry: Math.floor(roster.length / 3),
    prop_bet_keys: [...propBetKeys],
    status: "closed",
    display_mode: "full",
    latest_episode_num: null,
    season_complete: false,
  };
};

export const buildPoolCounters = (now: Date = new Date()): PoolCounters => ({
  entry_count: 0,
  updated_at: now.toISOString(),
});

export type PoolWrite =
  | { path: string; kind: "pool"; data: Pool }
  | { path: string; kind: "counters"; data: PoolCounters };

/**
 * Both documents a provisioning run creates.
 *
 * The counters document is seeded here rather than left to the recompute job:
 * the job has no season data to run against before the premiere, so without
 * this the entrant count would be missing for exactly the window the feature
 * exists for.
 */
export const buildProvisionWrites = ({
  now = new Date(),
  ...poolInput
}: BuildPoolDocumentInput & { now?: Date }): PoolWrite[] => {
  const pool = buildPoolDocument(poolInput);
  const poolPath = `pools/${pool.id}`;

  return [
    { path: poolPath, kind: "pool", data: pool },
    {
      path: `${poolPath}/meta/counters`,
      kind: "counters",
      data: buildPoolCounters(now),
    },
  ];
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

type Args = {
  seasonNum: number | null;
  write: boolean;
  overwrite: boolean;
};

export const parseArgs = (argv: readonly string[]): Args => {
  const parsed: Args = { seasonNum: null, write: false, overwrite: false };

  for (const arg of argv) {
    if (arg === "--write") parsed.write = true;
    else if (arg === "--overwrite") parsed.overwrite = true;
    else if (arg === "--dry-run") parsed.write = false;
    else if (!arg.startsWith("--")) {
      const n = Number(arg);
      if (!Number.isNaN(n)) parsed.seasonNum = n;
    }
  }

  return parsed;
};

const loadSeasonPlayers = async (seasonNum: number): Promise<RosterInput[]> => {
  const mod: Record<string, unknown> = await import(
    `../src/data/season_${seasonNum}/index.js`
  );
  const players = mod[`SEASON_${seasonNum}_PLAYERS`] as
    | RosterInput[]
    | undefined;

  if (!players) {
    throw new Error(
      `src/data/season_${seasonNum}/index.ts does not export SEASON_${seasonNum}_PLAYERS.`,
    );
  }
  return players;
};

const describeWrites = (writes: PoolWrite[], freezeAt: Date): void => {
  const pool = writes.find((w) => w.kind === "pool")!.data;

  console.log("");
  console.log(`  Pool id:         ${pool.id}`);
  console.log(`  Name:            ${pool.name}`);
  console.log(`  Freeze (ET):     ${formatFreezeInEastern(freezeAt)}`);
  console.log(`  Freeze (UTC):    ${freezeAt.toISOString()}`);
  console.log(`  Roster:          ${pool.roster.length} castaways`);
  console.log(`  Picks per entry: ${pool.picks_per_entry}`);
  console.log(`  Prop bet keys:   ${pool.prop_bet_keys.length}`);
  console.log(`  Status:          ${pool.status}`);
  console.log(`  Display mode:    ${pool.display_mode}`);
  console.log("");

  for (const write of writes) {
    console.log(`  ${write.path}`);
    const printable =
      write.kind === "pool"
        ? { ...write.data, freeze_at: `<Timestamp ${freezeAt.toISOString()}>` }
        : write.data;
    console.log(
      JSON.stringify(printable, null, 2)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
    console.log("");
  }
};

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

async function main(): Promise<void> {
  const { seasonNum, write, overwrite } = parseArgs(process.argv.slice(2));

  if (seasonNum === null) {
    fail("no season number given. Usage: yarn create-pool <season> [--write]");
    return;
  }

  const meta = SEASON_METADATA[`season_${seasonNum}` as Season["id"]];
  if (!meta)
    fail(
      `season ${seasonNum} is not registered in src/data/season-metadata.ts`,
    );

  const seasonCheck = checkSeasonEligible(meta, new Date());
  if (!seasonCheck.ok) fail(seasonCheck.reason);

  const players = await loadSeasonPlayers(seasonNum);
  const freezeAt = computeFreezeInstant(meta.premiere!);
  const poolId = poolIdForSeason(seasonNum);

  console.log(
    `${write ? "Creating" : "Previewing"} the pool for season ${seasonNum} (${meta.name}).`,
  );

  if (!write) {
    // Dry run builds the document with a plain structural timestamp so that
    // nothing here loads the Admin SDK or touches the network.
    const writes = buildProvisionWrites({
      seasonNum,
      seasonName: meta.name,
      premiere: meta.premiere!,
      players,
      toTimestamp: (date) => ({
        seconds: Math.floor(date.getTime() / 1000),
        nanoseconds: 0,
        toDate: () => date,
      }),
    });
    describeWrites(writes, freezeAt);
    console.log(
      "[DRY RUN] Nothing was written. Re-run with --write to create it.",
    );
    return;
  }

  // Admin SDK is loaded only on a real run: importing it initializes the app
  // and requires firebase-private-key.json.
  const { adminApp } = await import("./lib/admin.js");
  console.log(`  Firebase project: ${adminApp.options.projectId}`);

  const db = getFirestore();
  const existing = await db.doc(`pools/${poolId}`).get();
  const overwriteCheck = checkOverwriteAllowed(existing.exists, overwrite);
  if (!overwriteCheck.ok) fail(overwriteCheck.reason);

  const writes = buildProvisionWrites({
    seasonNum,
    seasonName: meta.name,
    premiere: meta.premiere!,
    players,
  });
  describeWrites(writes, freezeAt);

  const batch = db.batch();
  for (const item of writes) {
    batch.set(db.doc(item.path), item.data);
  }
  await batch.commit();

  console.log(`Created ${writes.map((w) => w.path).join(" and ")}.`);
  console.log(
    `The pool is "closed". Flip status to "open" when entries should be accepted.`,
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
      console.error("Pool provisioning failed:", err);
      process.exit(1);
    });
}

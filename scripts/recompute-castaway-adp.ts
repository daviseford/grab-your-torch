/**
 * Recompute and publish each season's castaway average draft position (ADP).
 *
 * ADP is an app-wide aggregate over other groups' drafts, which no browser
 * can compute: live drafts can be enumerated only by an admin, and reading
 * every competition from a drafter's browser would hand each drafter every
 * other group's member list. So this job reads with the Admin SDK and
 * publishes one numbers-only document per season at `castaway_adp/{season_id}`,
 * which signed-in readers may read and no client may write.
 *
 * Eligibility, aggregation, and the document shape live in
 * `src/utils/castawayAdp.ts`. This file only reads, reports, and writes.
 *
 * The published summary is a derived cache, rewritten wholesale on every run;
 * there is no incremental mode.
 *
 * Dry run by default. Nothing is written unless `--write` is passed.
 *
 * Usage:
 *   yarn recompute-castaway-adp 51                   # dry run, live read
 *   yarn recompute-castaway-adp 50 51                # several seasons
 *   yarn recompute-castaway-adp 51 --fixture f.json  # dry run, no Firebase
 *   yarn recompute-castaway-adp 51 --write           # publish
 *
 * A fixture is a JSON array of `{ id, created_at, data }`, where `created_at`
 * is an ISO instant (or null) and `data` is a competition document body.
 */

import * as fs from "fs";
import { EPISODE_SCHEDULES } from "../src/data/episode-schedules";
import { SEASON_METADATA } from "../src/data/season-metadata";
import { SEASONS } from "../src/data/seasons";
import type { Season } from "../src/types";
import {
  ADP_EXCLUSION_REASONS,
  type AdpCompetitionSource,
  type AdpPlan,
  CASTAWAY_ADP_COLLECTION,
  formatAdp,
  planCastawayAdp,
} from "../src/utils/castawayAdp";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

type SeasonSource = Pick<Season, "id" | "order" | "players" | "episodes">;

/**
 * The premiere's air date: survivoR's first episode when the season has
 * aired, else the advance broadcast listing, else the catalog's premiere.
 * Null means the premiere is unknown and the season cannot be cut safely.
 */
export const resolvePremiereAirDate = (
  season: SeasonSource,
  schedules: typeof EPISODE_SCHEDULES = EPISODE_SCHEDULES,
  metadata: typeof SEASON_METADATA = SEASON_METADATA,
): string | null =>
  season.episodes.find((episode) => episode.order === 1)?.air_date ??
  schedules[season.id]?.find((broadcast) => broadcast.order === 1)?.air_date ??
  metadata[season.id]?.premiere ??
  null;

/**
 * A minimal read-only view of the `competitions` collection. The Admin SDK
 * satisfies it structurally; there is no write method anywhere in it.
 */
export type CompetitionReader = {
  collection(name: "competitions"): {
    get(): Promise<{
      docs: {
        id: string;
        data(): unknown;
        createTime?: { toDate(): Date };
      }[];
    }>;
  };
};

/**
 * One read of the whole collection. Firestore's own `createTime` is the
 * promotion instant: competition docs carry no timestamp field, and a doc is
 * created once, when the draft's creator promotes the finished draft.
 */
export const loadCompetitions = async (
  db: CompetitionReader,
): Promise<AdpCompetitionSource[]> =>
  (await db.collection("competitions").get()).docs.map((doc) => ({
    id: doc.id,
    createdAt: doc.createTime?.toDate() ?? null,
    data: (doc.data() ?? {}) as Record<string, unknown>,
  }));

type FixtureRow = {
  id: string;
  created_at: string | null;
  data: Record<string, unknown>;
};

export const competitionsFromFixture = (
  rows: readonly FixtureRow[],
): AdpCompetitionSource[] =>
  rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at ? new Date(row.created_at) : null,
    data: row.data,
  }));

/* ------------------------------------------------------------------ *
 * Planning and reporting
 * ------------------------------------------------------------------ */

export type SeasonAdpPlan =
  | { seasonId: Season["id"]; ok: true; plan: AdpPlan }
  | { seasonId: Season["id"]; ok: false; reason: string };

export const planSeason = (
  season: SeasonSource | undefined,
  seasonId: Season["id"],
  competitions: readonly AdpCompetitionSource[],
  computedAt: string,
): SeasonAdpPlan => {
  if (!season) {
    return { seasonId, ok: false, reason: "not a registered season" };
  }
  const premiereAirDate = resolvePremiereAirDate(season);
  if (!premiereAirDate) {
    return {
      seasonId,
      ok: false,
      reason: "no premiere air date, so no draft can be shown to predate it",
    };
  }
  return {
    seasonId,
    ok: true,
    plan: planCastawayAdp({
      seasonId,
      seasonNum: season.order,
      castawayIds: season.players.map((player) => player.castaway_id),
      premiereAirDate,
      competitions,
      computedAt,
    }),
  };
};

/**
 * What the operator sees. Counts and castaway ids only: never a competition
 * id, uid, or name, so the output is safe in a public CI log.
 */
export const describePlan = (result: SeasonAdpPlan): string[] => {
  if (!result.ok) return [`${result.seasonId}: skipped, ${result.reason}.`];
  const { summary, excluded, published } = result.plan;
  const lines = [
    `${summary.season_id}: ${summary.draft_count} eligible draft(s) promoted before ${summary.premiere_cutoff}.`,
    `  Excluded: ${ADP_EXCLUSION_REASONS.map((r) => `${r} ${excluded[r]}`).join(", ")}.`,
  ];
  if (!published) {
    lines.push(
      `  Below the ${summary.min_drafts}-draft minimum: publishing the count with no per-castaway numbers.`,
    );
    return lines;
  }
  const ranked = Object.entries(summary.castaways).sort(
    ([, a], [, b]) => a!.adp - b!.adp,
  );
  for (const [id, stat] of ranked) {
    lines.push(
      `  ${id}  ADP ${formatAdp(stat!.adp)}  (${stat!.picks} pick(s), ${stat!.best}-${stat!.worst})`,
    );
  }
  return lines;
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export type Args = {
  seasonIds: Season["id"][];
  write: boolean;
  fixture: string | null;
};

export const parseArgs = (argv: readonly string[]): Args => {
  const parsed: Args = { seasonIds: [], write: false, fixture: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--dry-run") parsed.write = false;
    else if (arg === "--fixture") {
      i += 1;
      parsed.fixture = argv[i] ?? null;
    } else if (/^\d+$/.test(arg)) parsed.seasonIds.push(`season_${arg}`);
    else if (/^season_\d+$/.test(arg))
      parsed.seasonIds.push(arg as Season["id"]);
    else throw new Error(`Unrecognized argument "${arg}"`);
  }
  return parsed;
};

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

async function main(): Promise<void> {
  const { seasonIds, write, fixture } = parseArgs(process.argv.slice(2));

  if (seasonIds.length === 0) {
    fail(
      "no season given. Usage: yarn recompute-castaway-adp <season...> [--fixture <file>] [--write]",
    );
  }
  if (fixture && write) {
    fail("--fixture and --write cannot be combined");
  }

  let competitions: AdpCompetitionSource[];
  let firestore: import("firebase-admin/firestore").Firestore | null = null;

  if (fixture) {
    console.log(`Reading competitions from the fixture at ${fixture}.`);
    competitions = competitionsFromFixture(
      JSON.parse(fs.readFileSync(fixture, "utf-8")) as FixtureRow[],
    );
  } else {
    // Loaded only when Firebase is needed: importing it initializes the app
    // and requires firebase-private-key.json.
    const { adminApp } = await import("./lib/admin.js");
    const { getFirestore } = await import("firebase-admin/firestore");
    console.log(`Firebase project: ${adminApp.options.projectId}`);
    firestore = getFirestore();
    competitions = await loadCompetitions(
      firestore as unknown as CompetitionReader,
    );
  }

  const computedAt = new Date().toISOString();
  const seasons = SEASONS as Partial<Record<Season["id"], SeasonSource>>;
  const results = seasonIds.map((seasonId) =>
    planSeason(seasons[seasonId], seasonId, competitions, computedAt),
  );

  for (const result of results) {
    console.log("");
    for (const line of describePlan(result)) console.log(line);
  }

  if (!write || !firestore) {
    console.log("");
    console.log("Dry run: nothing written. Pass --write to publish.");
    return;
  }

  for (const result of results) {
    if (!result.ok) continue;
    const { summary } = result.plan;
    await firestore
      .collection(CASTAWAY_ADP_COLLECTION)
      .doc(summary.season_id)
      .set(summary);
    console.log(`Published ${CASTAWAY_ADP_COLLECTION}/${summary.season_id}.`);
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("ADP recompute failed:", err);
      process.exit(1);
    });
}

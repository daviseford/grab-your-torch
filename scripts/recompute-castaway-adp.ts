/**
 * Recompute and publish each season's castaway average draft position (ADP).
 *
 * ADP is an app-wide aggregate over other groups' drafts, which no browser
 * can compute: live drafts can be enumerated only by an admin, and checking a
 * draft's provenance needs Firebase Auth account records. So this job reads
 * with the Admin SDK and publishes numbers-only documents at
 * `castaway_adp/{season_id}_{cohort}`, which signed-in readers may read and no
 * client may write. Two cohorts per season:
 *
 *   pre_premiere  drafts saved as a competition before the premiere aired
 *   all_drafts    every qualifying draft, including after episodes aired
 *
 * Eligibility, aggregation, and the document shape live in
 * `src/utils/castawayAdp.ts`. This file only reads, reports, and writes.
 *
 * Dry run by default. `--write` publishes, requires `--project <id>` naming
 * the project the service account belongs to, touches only the named seasons
 * and cohorts, and rewrites a document only when its content changed.
 *
 * Usage:
 *   yarn recompute-castaway-adp 51                         # dry run, live read
 *   yarn recompute-castaway-adp 50 51 --cohort all_drafts  # one cohort
 *   yarn recompute-castaway-adp 51 --fixture f.json        # dry run, no Firebase
 *   yarn recompute-castaway-adp 51 --write --project survivor-fantasy-51c4b
 *
 * A fixture is a JSON object `{ competitions, accounts }`: `competitions` is
 * an array of `{ id, created_at, updated_at, data, source_draft }` (instants
 * as ISO strings or null, `data` a competition document body, `source_draft`
 * its Realtime Database draft or null) and `accounts` maps uid to the ISO
 * instant the account was created.
 */

import * as fs from "fs";
import { pathToFileURL } from "node:url";
import { EPISODE_SCHEDULES } from "../src/data/episode-schedules";
import { SEASON_METADATA } from "../src/data/season-metadata";
import { SEASONS } from "../src/data/seasons";
import type { Season } from "../src/types";
import {
  ADP_COHORTS,
  ADP_EXCLUSION_REASONS,
  type AdpAccounts,
  type AdpCohort,
  type AdpCompetitionSource,
  type AdpPlan,
  adpSummaryFingerprint,
  CASTAWAY_ADP_COLLECTION,
  castawayAdpDocId,
  planCastawayAdp,
} from "../src/utils/castawayAdp";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

type SeasonSource = Pick<Season, "id" | "order" | "players" | "episodes">;

/**
 * Premiere air dates for seasons the app has hosted drafts for whose local
 * episode data predates air dates. Source: survivoR `episodes` table
 * (github.com/doehm/survivoR, dev/json/episodes.json), `episode_date` of
 * episode 1, version US. Read-only metadata: no season outcome depends on it.
 */
export const KNOWN_PREMIERE_AIR_DATES: Partial<Record<Season["id"], string>> = {
  season_46: "2024-02-28",
  season_47: "2024-09-18",
  season_48: "2025-02-26",
  season_49: "2025-09-24",
};

/**
 * The premiere's air date: survivoR's first episode when the season has
 * aired, else the advance broadcast listing, else the catalog's premiere,
 * else the sourced table above. Null means the premiere is unknown and the
 * pre-premiere cohort cannot be cut safely.
 */
export const resolvePremiereAirDate = (
  season: SeasonSource,
  schedules: typeof EPISODE_SCHEDULES = EPISODE_SCHEDULES,
  metadata: typeof SEASON_METADATA = SEASON_METADATA,
  known: typeof KNOWN_PREMIERE_AIR_DATES = KNOWN_PREMIERE_AIR_DATES,
): string | null =>
  season.episodes.find((episode) => episode.order === 1)?.air_date ??
  schedules[season.id]?.find((broadcast) => broadcast.order === 1)?.air_date ??
  metadata[season.id]?.premiere ??
  known[season.id] ??
  null;

type Timestamp = { toDate(): Date };

/**
 * Minimal read-only views of Firestore, the Realtime Database, and Auth. The
 * Admin SDK satisfies them structurally; there is no write method in them.
 */
export type CompetitionReader = {
  collection(name: "competitions"): {
    get(): Promise<{
      docs: {
        id: string;
        data(): unknown;
        createTime?: Timestamp;
        updateTime?: Timestamp;
      }[];
    }>;
  };
};

export type DraftReader = {
  ref(path: string): { once(event: "value"): Promise<{ val(): unknown }> };
};

export type AccountReader = {
  getUsers(identifiers: { uid: string }[]): Promise<{
    users: { uid: string; metadata: { creationTime: string } }[];
  }>;
};

/**
 * Every competition of the named seasons, each joined to its Realtime
 * Database draft. Firestore's own `createTime` is the promotion instant and
 * `updateTime` the latest write; clients can set neither.
 */
export const loadCompetitions = async (
  db: CompetitionReader,
  drafts: DraftReader,
  seasonIds: readonly Season["id"][],
): Promise<AdpCompetitionSource[]> => {
  const wanted = new Set<string>(seasonIds);
  const docs = (await db.collection("competitions").get()).docs
    .map((doc) => ({
      doc,
      data: (doc.data() ?? {}) as Record<string, unknown>,
    }))
    .filter(({ data }) => wanted.has(data.season_id as string));

  return Promise.all(
    docs.map(async ({ doc, data }) => {
      const draftId = data.draft_id;
      const sourceDraft =
        typeof draftId === "string" && /^draft_[\w-]+$/.test(draftId)
          ? ((
              await drafts.ref(`drafts/${draftId}`).once("value")
            ).val() as Record<string, unknown> | null)
          : null;
      return {
        id: doc.id,
        createdAt: doc.createTime?.toDate() ?? null,
        updatedAt: doc.updateTime?.toDate() ?? null,
        data,
        sourceDraft: sourceDraft ?? null,
      };
    }),
  );
};

/** Account creation times for every participant, 100 uids per Auth call. */
export const loadAccounts = async (
  auth: AccountReader,
  competitions: readonly AdpCompetitionSource[],
): Promise<Map<string, Date>> => {
  const uids = [
    ...new Set(
      competitions.flatMap(({ data }) =>
        Array.isArray(data.participant_uids)
          ? data.participant_uids.filter(
              (uid): uid is string => typeof uid === "string" && uid !== "",
            )
          : [],
      ),
    ),
  ];
  const accounts = new Map<string, Date>();
  for (let i = 0; i < uids.length; i += 100) {
    const { users } = await auth.getUsers(
      uids.slice(i, i + 100).map((uid) => ({ uid })),
    );
    for (const user of users) {
      const created = new Date(user.metadata.creationTime);
      if (!Number.isNaN(created.getTime())) accounts.set(user.uid, created);
    }
  }
  return accounts;
};

type FixtureRow = {
  id: string;
  created_at: string | null;
  updated_at?: string | null;
  data: Record<string, unknown>;
  source_draft?: Record<string, unknown> | null;
};

export type Fixture = {
  competitions: FixtureRow[];
  accounts: Record<string, string>;
  /** Season ids whose castaway ids were remapped (see below). */
  remapped_seasons?: string[];
};

const toDate = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

export const readFixture = (
  fixture: Fixture,
): { competitions: AdpCompetitionSource[]; accounts: AdpAccounts } => ({
  competitions: fixture.competitions.map((row) => ({
    id: row.id,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    data: row.data,
    sourceDraft: row.source_draft ?? null,
  })),
  accounts: new Map(
    Object.entries(fixture.accounts ?? {}).map(([uid, iso]) => [
      uid,
      new Date(iso),
    ]),
  ),
});

/* ------------------------------------------------------------------ *
 * Planning and reporting
 * ------------------------------------------------------------------ */

export type SeasonAdpPlan =
  | { seasonId: Season["id"]; cohort: AdpCohort; ok: true; plan: AdpPlan }
  | { seasonId: Season["id"]; cohort: AdpCohort; ok: false; reason: string };

export const planSeason = (
  season: SeasonSource | undefined,
  seasonId: Season["id"],
  cohort: AdpCohort,
  competitions: readonly AdpCompetitionSource[],
  accounts: AdpAccounts,
  computedAt: string,
  thresholds: { minDrafts?: number; minCreators?: number } = {},
): SeasonAdpPlan => {
  if (!season) {
    return { seasonId, cohort, ok: false, reason: "not a registered season" };
  }
  const premiereAirDate = resolvePremiereAirDate(season);
  if (cohort === "pre_premiere" && !premiereAirDate) {
    return {
      seasonId,
      cohort,
      ok: false,
      reason: "no premiere air date, so no draft can be shown to predate it",
    };
  }
  return {
    seasonId,
    cohort,
    ok: true,
    plan: planCastawayAdp({
      seasonId,
      seasonNum: season.order,
      cohort,
      castawayIds: season.players.map((player) => player.castaway_id),
      premiereAirDate,
      competitions,
      accounts,
      computedAt,
      ...thresholds,
    }),
  };
};

/**
 * The pre-premiere summary of a season whose castaway ids were remapped.
 *
 * `yarn remap-castaway-ids` rewrites every competition of the season after
 * the premiere, so Firestore's `updateTime` no longer says when a draft was
 * saved and every record would read as `edited_after_premiere`. The remap
 * permutes the published pre-premiere summary in place instead, and this job
 * leaves it alone from then on. The cohort was closed at the premiere anyway.
 * A season counts as remapped once its ledger document exists.
 */
export const frozenPrePremiere = (seasonId: Season["id"]): SeasonAdpPlan => ({
  seasonId,
  cohort: "pre_premiere",
  ok: false,
  reason:
    "castaway ids were remapped after the premiere, so the pre-premiere summary is frozen as remapped",
});

/** `admin_migrations/castaway_id_remap_season_N`, as written by the remap. */
export const remapLedgerPath = (seasonId: Season["id"]): string =>
  `admin_migrations/castaway_id_remap_${seasonId}`;

/**
 * What the operator sees. Counts only: never a competition id, uid, name, or
 * castaway figure, so the output is safe in a public CI log.
 */
export const describePlan = (result: SeasonAdpPlan): string[] => {
  const label = `${result.seasonId} ${result.cohort}`;
  if (!result.ok) return [`${label}: skipped, ${result.reason}.`];
  const { summary, excluded, withheld } = result.plan;
  const window =
    summary.premiere_cutoff !== null
      ? ` saved before ${summary.premiere_cutoff} and not written since`
      : "";
  return [
    `${label}: ${summary.draft_count} qualifying draft(s)${window}.`,
    `  Excluded: ${ADP_EXCLUSION_REASONS.map((r) => `${r} ${excluded[r]}`).join(", ")}.`,
    `  Castaways published: ${Object.keys(summary.castaways).length}; withheld below ${summary.min_drafts} drafts from ${summary.min_creators} creators: ${withheld}.`,
  ];
};

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

export type Args = {
  seasonIds: Season["id"][];
  cohorts: AdpCohort[];
  write: boolean;
  fixture: string | null;
  project: string | null;
};

export const parseArgs = (argv: readonly string[]): Args => {
  const parsed: Args = {
    seasonIds: [],
    cohorts: [...ADP_COHORTS],
    write: false,
    fixture: null,
    project: null,
  };
  const value = (i: number, flag: string) => {
    const next = argv[i];
    if (!next || next.startsWith("--"))
      throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") parsed.write = true;
    else if (arg === "--dry-run") parsed.write = false;
    else if (arg === "--fixture") parsed.fixture = value(++i, arg);
    else if (arg === "--project") parsed.project = value(++i, arg);
    else if (arg === "--cohort") {
      const cohort = value(++i, arg);
      if (!(ADP_COHORTS as readonly string[]).includes(cohort))
        throw new Error(`Unknown cohort "${cohort}"`);
      parsed.cohorts = [cohort as AdpCohort];
    } else if (/^\d+$/.test(arg))
      parsed.seasonIds.push(`season_${Number(arg)}`);
    else if (/^season_\d+$/.test(arg))
      parsed.seasonIds.push(arg as Season["id"]);
    else throw new Error(`Unrecognized argument "${arg}"`);
  }
  return parsed;
};

export type SummaryStore = {
  read(docId: string): Promise<unknown>;
  write(docId: string, summary: AdpPlan["summary"]): Promise<void>;
};

/**
 * Publish each successful plan whose content differs from what is stored.
 * Returns what happened per document, for the log.
 */
export const publishPlans = async (
  results: readonly SeasonAdpPlan[],
  store: SummaryStore,
): Promise<string[]> => {
  const lines: string[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    const { summary } = result.plan;
    const docId = castawayAdpDocId(summary.season_id, summary.cohort);
    const stored = await store.read(docId);
    if (
      stored !== undefined &&
      stored !== null &&
      adpSummaryFingerprint(stored) === adpSummaryFingerprint(summary)
    ) {
      lines.push(`Unchanged ${CASTAWAY_ADP_COLLECTION}/${docId}: not written.`);
      continue;
    }
    await store.write(docId, summary);
    lines.push(`Published ${CASTAWAY_ADP_COLLECTION}/${docId}.`);
  }
  return lines;
};

const fail = (message: string): never => {
  console.error(`Refusing to run: ${message}.`);
  process.exit(1);
};

async function main(): Promise<void> {
  const { seasonIds, cohorts, write, fixture, project } = parseArgs(
    process.argv.slice(2),
  );

  if (seasonIds.length === 0) {
    fail(
      "no season given. Usage: yarn recompute-castaway-adp <season...> [--cohort <cohort>] [--fixture <file>] [--write --project <id>]",
    );
  }
  if (fixture && write) {
    fail("--fixture and --write cannot be combined");
  }
  if (write && !project) {
    fail("--write needs --project <id> naming the project to publish to");
  }

  let competitions: AdpCompetitionSource[];
  let accounts: AdpAccounts;
  let remapped: Set<string>;
  let firestore: import("firebase-admin/firestore").Firestore | null = null;

  if (fixture) {
    console.log(`Reading competitions from the fixture at ${fixture}.`);
    const parsedFixture = JSON.parse(
      fs.readFileSync(fixture, "utf-8"),
    ) as Fixture;
    ({ competitions, accounts } = readFixture(parsedFixture));
    remapped = new Set(parsedFixture.remapped_seasons ?? []);
    competitions = competitions.filter((c) =>
      (seasonIds as string[]).includes(c.data.season_id as string),
    );
  } else {
    // Loaded only when Firebase is needed: importing it initializes the app
    // and requires firebase-private-key.json.
    const { adminApp, adminAuth } = await import("./lib/admin.js");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getDatabase } = await import("firebase-admin/database");
    const projectId = adminApp.options.projectId;
    console.log(`Firebase project: ${projectId}`);
    if (write && projectId !== project) {
      fail(
        `--project ${project} does not match the service account's project ${projectId}`,
      );
    }
    firestore = getFirestore();
    const db = firestore;
    remapped = new Set(
      (
        await Promise.all(
          seasonIds.map(async (id) =>
            (await db.doc(remapLedgerPath(id)).get()).exists ? id : null,
          ),
        )
      ).filter((id): id is Season["id"] => id !== null),
    );
    competitions = await loadCompetitions(
      firestore as unknown as CompetitionReader,
      getDatabase() as unknown as DraftReader,
      seasonIds,
    );
    accounts = await loadAccounts(
      adminAuth as unknown as AccountReader,
      competitions,
    );
  }

  const computedAt = new Date().toISOString();
  const seasons = SEASONS as Partial<Record<Season["id"], SeasonSource>>;
  const results = seasonIds.flatMap((seasonId) =>
    cohorts.map((cohort) =>
      cohort === "pre_premiere" && remapped.has(seasonId)
        ? frozenPrePremiere(seasonId)
        : planSeason(
            seasons[seasonId],
            seasonId,
            cohort,
            competitions,
            accounts,
            computedAt,
          ),
    ),
  );

  for (const result of results) {
    console.log("");
    for (const line of describePlan(result)) console.log(line);
  }

  if (!write || !firestore) {
    console.log("");
    console.log(
      "Dry run: nothing written. Pass --write --project <id> to publish.",
    );
    return;
  }

  const collection = firestore.collection(CASTAWAY_ADP_COLLECTION);
  console.log("");
  const lines = await publishPlans(results, {
    read: async (docId) => (await collection.doc(docId).get()).data(),
    write: async (docId, summary) => {
      await collection.doc(docId).set(summary);
    },
  });
  for (const line of lines) console.log(line);
}

/**
 * Whether the module at `moduleUrl` is the script node was started with.
 * `pathToFileURL` builds the same URL node gives `import.meta.url` on every
 * platform: a hand-built `file:///` + path is right on Windows but gains a
 * fourth slash for a POSIX path, which made the scheduled Linux job exit 0
 * without ever running.
 */
export const isDirectRun = (
  moduleUrl: string,
  entryPath: string | undefined,
): boolean => !!entryPath && moduleUrl === pathToFileURL(entryPath).href;

if (isDirectRun(import.meta.url, process.argv[1])) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("ADP recompute failed:", err);
      process.exit(1);
    });
}

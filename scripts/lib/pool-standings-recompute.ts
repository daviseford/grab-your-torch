import type { PropBetQuestionKey } from "../../src/data/propbets";
import { PropBetsQuestions } from "../../src/data/propbets";
import type {
  CastawayId,
  Challenge,
  Elimination,
  Episode,
  FirestoreTimestamp,
  GameEvent,
  Pool,
  PoolCounters,
  PoolPick,
  PoolStandings,
  PoolStandingsPage,
  PoolStandingsRow,
  PoolStandingsStamp,
} from "../../src/types";
import { rankPoolEntries } from "../../src/utils/poolRanking";
import { buildPoolStandingsDocuments } from "../../src/utils/poolStandings";
import { getPropBetScoresForUser } from "../../src/utils/propBetUtils";
import { getSeasonPointsByCastaway } from "../../src/utils/seasonPoints";
import {
  auditPoolPicks,
  describeAudit,
  type AuditablePoolEntry,
  type PoolPickAudit,
} from "../repair-pool-picks.js";

/* ------------------------------------------------------------------ *
 * Ids and timestamps
 * ------------------------------------------------------------------ */

/**
 * The standings document id for an episode.
 *
 * `episode_${string}` ids sort lexicographically, so `episode_10` precedes
 * `episode_2`. Nothing in this job derives "the newest" from a sorted query:
 * every ordering here is numeric and the pointer on the config is explicit.
 */
export const poolStandingsDocId = (episodeNum: number): `episode_${string}` =>
  `episode_${episodeNum}`;

/** Both halves of a Firestore timestamp, whatever SDK or snapshot produced it. */
const timestampParts = (
  value: unknown,
): { seconds: number; nanoseconds: number } | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const seconds = raw.seconds ?? raw._seconds;
  const nanoseconds = raw.nanoseconds ?? raw._nanoseconds ?? 0;
  if (typeof seconds !== "number" || typeof nanoseconds !== "number") {
    return null;
  }
  return { seconds, nanoseconds };
};

export const sameFirestoreTimestamp = (a: unknown, b: unknown): boolean => {
  const left = timestampParts(a);
  const right = timestampParts(b);
  if (!left || !right) return false;
  return (
    left.seconds === right.seconds && left.nanoseconds === right.nanoseconds
  );
};

export const describeTimestamp = (value: unknown): string => {
  const parts = timestampParts(value);
  return parts
    ? new Date(parts.seconds * 1000).toISOString()
    : "<no timestamp>";
};

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/** The season result data a run scores against, already materialized. */
export type PoolSeasonData = {
  episodes: Episode[];
  challenges: Challenge[];
  eliminations: Elimination[];
  events: GameEvent[];
};

/**
 * One entrant.
 *
 * `uid` is the entry *document* id. It orders tied rows and is dropped before
 * anything is serialized: standings are world-readable and no collection in
 * this project publishes Firebase uids (KTD6).
 */
export type RecomputeEntry = {
  uid: string;
  handle: string;
  picks: PoolPick[];
  /**
   * Raw stored answers. Security rules constrain the keys and allowed values,
   * but older entries and Admin SDK writes may bypass those constraints.
   * Sanitize each answer against its question before it reaches the scorer.
   */
  prop_bets: unknown;
};

/** A standings document that already exists, reduced to what the guards need. */
export type ExistingStandings = {
  episode_num: number;
  entry_count: number;
  freeze_at: unknown;
};

export type RecomputeRevisions = {
  /** The season document's content hash. Half of the cache stamp (KTD5). */
  data_revision: string;
  /** This job's own scoring-code revision. The other half. */
  scoring_revision: string;
  /** What the season data was last written with. Warned about, not enforced. */
  season_scoring_revision?: string;
};

export type RecomputeInput = {
  pool: Pick<
    Pool,
    | "id"
    | "season_id"
    | "season_num"
    | "name"
    | "freeze_at"
    | "roster"
    | "picks_per_entry"
    | "prop_bet_keys"
    | "status"
    | "display_mode"
    | "latest_episode_num"
    | "season_complete"
  >;
  entries: RecomputeEntry[];
  data: PoolSeasonData;
  revisions: RecomputeRevisions;
  existingStandings: ExistingStandings[];
  /** ISO instant stamped on every document this run produces. */
  computedAt: string;
  /** Allow a standings document to replace one with more entrants. */
  force?: boolean;
};

/* ------------------------------------------------------------------ *
 * Refusals
 *
 * Each of these is the difference between a loud failure and a wrong public
 * leaderboard, so each throws rather than warning.
 * ------------------------------------------------------------------ */

export type RefusalCode =
  | "pick_audit"
  | "freeze_drift"
  | "entry_count_regression";

export class RecomputeRefusal extends Error {
  readonly code: RefusalCode;
  readonly details: string[];

  constructor(code: RefusalCode, message: string, details: string[] = []) {
    super(message);
    this.name = "RecomputeRefusal";
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ *
 * Episode ordering
 * ------------------------------------------------------------------ */

/**
 * The newest episode that has both a season-document entry and result data.
 *
 * Derived numerically from `episode_num` on the records, never from a sorted
 * query over document ids. Returns null when nothing has aired, which is the
 * normal state of a pool between provisioning and the premiere.
 */
export const latestEpisodeWithData = (data: PoolSeasonData): number | null => {
  const recorded = [...data.challenges, ...data.eliminations, ...data.events]
    .map((record) => record.episode_num)
    .filter((num) => typeof num === "number" && Number.isFinite(num));

  if (recorded.length === 0) return null;

  const highestWithData = Math.max(...recorded);
  const known = data.episodes
    .map((episode) => episode.order)
    .filter((order) => Number.isFinite(order) && order <= highestWithData);

  return known.length === 0 ? null : Math.max(...known);
};

/* ------------------------------------------------------------------ *
 * Untrusted prop bet answers
 * ------------------------------------------------------------------ */

const BOOLEAN_ANSWERS = new Set(["Yes", "No"]);

/**
 * Keep only answer values this codebase recognizes.
 *
 * An entrant can store a non-string, a nested map, or a very large string in
 * their own entry, because rules cannot reach answer *values*. An
 * unrecognized value is dropped rather than thrown on: a malformed answer
 * should score zero for the entrant who wrote it, not take the whole
 * leaderboard down.
 */
export const sanitizePropBetAnswers = (
  raw: unknown,
  activeKeys: readonly PropBetQuestionKey[],
  rosterIds: ReadonlySet<CastawayId>,
): Partial<Record<PropBetQuestionKey, string>> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const stored = raw as Record<string, unknown>;
  const clean: Partial<Record<PropBetQuestionKey, string>> = {};

  for (const key of activeKeys) {
    const question = PropBetsQuestions[key];
    if (!question) continue;

    const value = stored[key];
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (trimmed.length === 0) continue;

    if (question.answer_type === "boolean") {
      if (BOOLEAN_ANSWERS.has(trimmed)) clean[key] = trimmed;
      continue;
    }

    if (rosterIds.has(trimmed as CastawayId)) {
      clean[key] = trimmed;
    }
  }

  return clean;
};

/* ------------------------------------------------------------------ *
 * The sockpuppet signal
 * ------------------------------------------------------------------ */

/**
 * Sizes of the clusters of entrants holding identical pick sets.
 *
 * Counts only. This repository is public, so the job summary is
 * world-readable: naming handles and their picks there would publish before
 * the freeze exactly what R19 hides, and after it exactly what R17 bans.
 * Identical picks are not proof of anything either, which is why the risk
 * register accepts sockpuppets and asks only for a signal.
 */
export const clusterIdenticalEntries = (
  entries: readonly RecomputeEntry[],
): number[] => {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const signature = entry.picks
      .map((pick) => pick.castaway_id)
      .slice()
      .sort()
      .join("|");
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  return [...counts.values()].filter((size) => size > 1).sort((a, b) => b - a);
};

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

export type PlannedEpisode = {
  episode_num: number;
  summary: PoolStandings;
  pages: PoolStandingsPage[];
};

export type RecomputePlan = {
  status: "ok" | "empty" | "no_data";
  /** Why a non-ok run is not a failure. Printed, never thrown. */
  reason: string;
  computed_at: string;
  entry_count: number;
  latest_episode_num: number | null;
  season_complete: boolean;
  episodes: PlannedEpisode[];
  audit: PoolPickAudit;
  /** Aggregate only: sizes of identical-pick clusters, largest first. */
  clusters: number[];
  revisions: RecomputeRevisions;
};

const auditable = (entries: readonly RecomputeEntry[]): AuditablePoolEntry[] =>
  entries.map((entry) => ({
    id: entry.uid,
    handle: entry.handle,
    picks: entry.picks,
  }));

/** The per-castaway points arrays truncated to the first `count` episodes. */
const pointsThrough = (
  full: Record<string, { episode_num: number; total: number }[]>,
  count: number,
) =>
  Object.fromEntries(
    Object.entries(full).map(([castawayId, perEpisode]) => [
      castawayId,
      perEpisode.slice(0, count),
    ]),
  ) as Parameters<typeof rankPoolEntries>[1];

/**
 * Build every standings document a run would publish.
 *
 * Pure by construction: there is no database in the signature, which is what
 * makes "entries are read once per run" true structurally rather than by
 * convention. The episode loop below could not re-read entries if it wanted
 * to.
 */
export const planRecompute = (input: RecomputeInput): RecomputePlan => {
  const {
    pool,
    entries,
    data,
    revisions,
    existingStandings,
    computedAt,
    force = false,
  } = input;

  const audit = auditPoolPicks(pool.roster, auditable(entries));
  const clusters = clusterIdenticalEntries(entries);

  const emptyPlan = (
    status: "empty" | "no_data",
    reason: string,
  ): RecomputePlan => ({
    status,
    reason,
    computed_at: computedAt,
    entry_count: entries.length,
    latest_episode_num: null,
    season_complete: false,
    episodes: [],
    audit,
    clusters,
    revisions,
  });

  if (entries.length === 0) {
    return emptyPlan("empty", "the pool has no entries");
  }

  const latest = latestEpisodeWithData(data);
  if (latest === null) {
    return emptyPlan(
      "no_data",
      "no episode of this season has result data in Firestore yet",
    );
  }

  // Gate publication on the pick audit (R23). An entrant whose pick cannot be
  // matched scores zero on that castaway for the whole season, on a public
  // leaderboard, with no recourse, because post-freeze rules permit handle
  // edits only. Roster name collisions and repairable-by-name mismatches fail
  // it too: a stale stored id misattributes points exactly as silently.
  if (!audit.ok) {
    throw new RecomputeRefusal(
      "pick_audit",
      "stored picks disagree with the pool configuration roster",
      describeAudit(audit),
    );
  }

  // A moved deadline is otherwise invisible (KTD4). The earliest published
  // document is found numerically: `episode_10` sorts before `episode_2`.
  const earliest = [...existingStandings].sort(
    (a, b) => a.episode_num - b.episode_num,
  )[0];
  if (earliest && !sameFirestoreTimestamp(earliest.freeze_at, pool.freeze_at)) {
    throw new RecomputeRefusal(
      "freeze_drift",
      "the pool freeze instant no longer matches the published standings",
      [
        `  Config:            ${describeTimestamp(pool.freeze_at)}`,
        `  ${poolStandingsDocId(earliest.episode_num)}: ${describeTimestamp(earliest.freeze_at)}`,
        "  Republishing would silently move a deadline entrants already played to.",
      ],
    );
  }

  const previousByEpisode = new Map(
    existingStandings.map((doc) => [doc.episode_num, doc]),
  );

  const airedEpisodes = data.episodes
    .filter((episode) => episode.order <= latest)
    .slice()
    .sort((a, b) => a.order - b.order);

  const inScope = <T extends { episode_num: number }>(records: T[]): T[] =>
    records.filter((record) => record.episode_num <= latest);

  const challenges = inScope(data.challenges);
  const eliminations = inScope(data.eliminations);
  const events = inScope(data.events);

  const rosterIds = pool.roster.map((member) => member.castaway_id);
  const rosterIdSet = new Set(rosterIds);

  // Derived once for the whole run. The result arrays are dense and index
  // aligned to `airedEpisodes`, so episode N's cumulative points are the
  // first N entries -- no ownership helper is involved anywhere (KTD10).
  const fullPoints = getSeasonPointsByCastaway(
    challenges,
    eliminations,
    events,
    airedEpisodes,
    rosterIds,
  );

  const entriesForRanking = entries.map((entry) => ({
    uid: entry.uid,
    handle: entry.handle,
    picks: entry.picks,
  }));

  // Sanitized once, not once per episode.
  const answersByUid = new Map(
    entries.map((entry) => [
      entry.uid,
      sanitizePropBetAnswers(entry.prop_bets, pool.prop_bet_keys, rosterIdSet),
    ]),
  );

  const episodes: PlannedEpisode[] = [];

  for (const [index, episode] of airedEpisodes.entries()) {
    const episodeNum = episode.order;
    const throughEpisode = <T extends { episode_num: number }>(records: T[]) =>
      records.filter((record) => record.episode_num <= episodeNum);

    const episodeEvents = throughEpisode(events);
    const episodeEliminations = throughEpisode(eliminations);
    const episodeChallenges = throughEpisode(challenges);

    const postMergeEpisodeNumbers = new Set(
      airedEpisodes
        .slice(0, index + 1)
        .filter((ep) => ep.post_merge)
        .map((ep) => ep.order),
    );
    const hasFinaleOccurred = episodeEvents.some(
      (event) => event.action === "win_survivor",
    );

    // Computed once per episode into a lookup. Calling the scorer inside the
    // sort comparator would turn the sort superlinear in event count.
    const propBetPointsByUid: Record<string, number> = {};
    for (const entry of entries) {
      const answers = answersByUid.get(entry.uid) ?? {};
      if (Object.keys(answers).length === 0) {
        propBetPointsByUid[entry.uid] = 0;
        continue;
      }
      propBetPointsByUid[entry.uid] = getPropBetScoresForUser({
        uid: entry.uid,
        // Explicit, never derived (KTD12): the old fall-through reached an
        // email address, which cannot go near a world-readable document.
        displayName: entry.handle,
        answers,
        events: episodeEvents,
        eliminations: episodeEliminations,
        challenges: episodeChallenges,
        postMergeEpisodeNumbers,
        hasFinaleOccurred,
        activeKeys: pool.prop_bet_keys,
      }).total;
    }

    const ranked = rankPoolEntries(
      entriesForRanking,
      pointsThrough(fullPoints, index + 1),
      propBetPointsByUid,
    );

    // The uid orders tied rows and stops here.
    const rows: PoolStandingsRow[] = ranked.map((row) => ({
      handle: row.handle,
      total: row.total_points,
      prop_bet_points: row.prop_bet_points,
      rank: row.rank,
    }));

    const previous = previousByEpisode.get(episodeNum);
    if (previous && previous.entry_count > rows.length && !force) {
      throw new RecomputeRefusal(
        "entry_count_regression",
        `standings for episode ${episodeNum} would lose entrants`,
        [
          `  Published: ${previous.entry_count} entrants`,
          `  This run:  ${rows.length} entrants`,
          "  Pass --force only when the field genuinely shrank.",
        ],
      );
    }

    const stamp: PoolStandingsStamp = {
      episode_num: episodeNum,
      computed_at: computedAt,
      data_revision: revisions.data_revision,
      scoring_revision: revisions.scoring_revision,
      freeze_at: pool.freeze_at as FirestoreTimestamp,
    };

    const { summary, pages } = buildPoolStandingsDocuments(rows, stamp);
    episodes.push({ episode_num: episodeNum, summary, pages });
  }

  return {
    status: "ok",
    reason: "",
    computed_at: computedAt,
    entry_count: entries.length,
    latest_episode_num: latest,
    // The public module cannot read events itself (R22), so the job is what
    // makes completion visible.
    season_complete: events.some((event) => event.action === "win_survivor"),
    episodes,
    audit,
    clusters,
    revisions,
  };
};

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export type StandingsWriteKind =
  | "standings"
  | "standings_page"
  | "counters"
  | "config";

export type StandingsWrite = {
  path: string;
  op: "set" | "update";
  kind: StandingsWriteKind;
  data: unknown;
};

export type StandingsWriter = {
  set(path: string, data: unknown): Promise<void>;
  update(path: string, data: unknown): Promise<void>;
};

/**
 * Every write a run performs, in the order it performs them.
 *
 * Overflow pages precede the summary that counts them, episodes ascend
 * numerically, counters follow, and the config pointer flips last. A reader
 * that lands mid-run therefore sees the previous episode's complete
 * standings, never a fresh pointer aimed at documents that are still stale or
 * absent.
 */
export const buildStandingsWrites = (
  poolId: string,
  plan: RecomputePlan,
): StandingsWrite[] => {
  const writes: StandingsWrite[] = [];
  const base = `pools/${poolId}`;

  // Counters live beside the config, never on it (KTD3): the config is a
  // rules input for every entry write, and a bad job payload must not be able
  // to take the freeze with it.
  //
  // They are written for every plan, including "empty" and "no_data". The
  // entry window is weeks of runs with no episode data at all, and the
  // entrant count is the one number the homepage shows during it, so gating
  // this on a publishable plan would pin it at zero for exactly the window
  // the pool exists for.
  const counters: PoolCounters = {
    entry_count: plan.entry_count,
    updated_at: plan.computed_at,
  };
  writes.push({
    path: `${base}/meta/counters`,
    op: "set",
    kind: "counters",
    data: counters,
  });

  if (plan.status !== "ok") return writes;

  for (const episode of plan.episodes) {
    const docId = poolStandingsDocId(episode.episode_num);

    for (const page of episode.pages) {
      writes.push({
        path: `${base}/standings/${docId}/pages/${page.page}`,
        op: "set",
        kind: "standings_page",
        data: page,
      });
    }

    writes.push({
      path: `${base}/standings/${docId}`,
      op: "set",
      kind: "standings",
      data: episode.summary,
    });
  }

  writes.push({
    path: base,
    op: "update",
    kind: "config",
    data: {
      latest_episode_num: plan.latest_episode_num,
      season_complete: plan.season_complete,
      // Stamped so a browser cache keyed on it misses after an in-place
      // republish of the same episode. Without it a corrected leaderboard
      // never reaches a visitor who already cached that episode, because
      // neither the episode number nor the scoring revision changes.
      standings_computed_at: plan.computed_at,
    },
  });

  return writes;
};

/* ------------------------------------------------------------------ *
 * Job summary
 *
 * GitHub Actions job summaries are world-readable in a public repository, so
 * this carries counts and nothing else: no handle, no pick, no castaway name,
 * no uid, no per-entry timestamp.
 * ------------------------------------------------------------------ */

export const standingsByteSize = (plan: RecomputePlan): number =>
  plan.episodes.reduce(
    (total, episode) =>
      total +
      Buffer.byteLength(JSON.stringify(episode.summary), "utf8") +
      episode.pages.reduce(
        (pageTotal, page) =>
          pageTotal + Buffer.byteLength(JSON.stringify(page), "utf8"),
        0,
      ),
    0,
  );

export const buildJobSummary = (
  poolId: string,
  plan: RecomputePlan,
  durationMs: number,
): string => {
  const lines: string[] = [
    "## Pool standings recompute",
    "",
    `- Pool: \`${poolId}\``,
    `- Result: ${plan.status}${plan.reason ? ` (${plan.reason})` : ""}`,
    `- Entrants: ${plan.entry_count}`,
    `- Episodes published: ${plan.episodes.length}`,
    `- Newest episode: ${plan.latest_episode_num ?? "none"}`,
    `- Season complete: ${plan.season_complete ? "yes" : "no"}`,
    `- Standings bytes: ${standingsByteSize(plan)}`,
    `- Duration ms: ${durationMs}`,
    `- Data revision: \`${plan.revisions.data_revision || "none"}\``,
    `- Scoring revision: \`${plan.revisions.scoring_revision}\``,
    "",
  ];

  if (plan.episodes.length > 0) {
    lines.push(
      "| Episode | Rows | Pages |",
      "| --- | ---: | ---: |",
      ...plan.episodes.map(
        (episode) =>
          `| \`${poolStandingsDocId(episode.episode_num)}\` | ` +
          `${episode.summary.entry_count} | ${episode.pages.length} |`,
      ),
      "",
    );
  }

  lines.push(
    "### Identical-pick clusters",
    "",
    plan.clusters.length === 0
      ? "None. No two entrants hold the same set of picks."
      : `${plan.clusters.length} cluster(s), sizes: ${plan.clusters.join(", ")}. ` +
          "Counts only: identical picks are not proof of anything, and this summary is public.",
    "",
  );

  return lines.join("\n");
};

export const buildJobMetrics = (
  poolId: string,
  plan: RecomputePlan,
  durationMs: number,
) => ({
  pool_id: poolId,
  status: plan.status,
  reason: plan.reason,
  computed_at: plan.computed_at,
  entry_count: plan.entry_count,
  latest_episode_num: plan.latest_episode_num,
  season_complete: plan.season_complete,
  standings_bytes: standingsByteSize(plan),
  duration_ms: durationMs,
  data_revision: plan.revisions.data_revision,
  scoring_revision: plan.revisions.scoring_revision,
  episodes: plan.episodes.map((episode) => ({
    episode_id: poolStandingsDocId(episode.episode_num),
    rows: episode.summary.entry_count,
    pages: episode.pages.length,
  })),
  identical_pick_cluster_sizes: plan.clusters,
});

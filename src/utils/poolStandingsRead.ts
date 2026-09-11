import type {
  Pool,
  PoolDisplayMode,
  PoolId,
  PoolStandings,
  PoolStandingsPage,
  PoolStandingsStamp,
} from "../types";

/**
 * The public leaderboard read path, as pure functions (U8).
 *
 * Everything the browser decides before it reads anything lives here: which
 * documents to fetch and at what paths, whether what came back is fresh,
 * stale or absent, what is therefore on screen, and which fields of a row may
 * reach it. `usePoolStandings` is a thin shell around these, because this
 * project tests pure functions and not components.
 *
 * THE SEASON-DOCUMENT BOUNDARY, which is the load-bearing decision here.
 *
 * A published standings document is stamped with two revisions (KTD5), and
 * either mismatching means stale. The scoring revision is free: it is a
 * constant compiled into the bundle. The season-data revision is not. It
 * lives on the season document, and reading that document is exactly what R22
 * forbids on the homepage and what the plan's headline Playwright assertion
 * checks for.
 *
 * So the comparison is split by surface, and the split is structural rather
 * than a matter of remembering:
 *
 *  - NOTHING in this path ever reads a season document. There is no such
 *    fetch here to accidentally trigger, whatever a caller passes.
 *  - `resolvePoolStandingsFreshness` compares the scoring revision always.
 *    That check alone is what the homepage gets, and it is enough to catch
 *    the failure the plan actually names: a scoring rule changes, the bundle
 *    ships, and the cache silently disagrees with the deployed code.
 *  - The data-revision comparison happens only when a caller hands one in.
 *    A caller can only have one if it is already reading the season document
 *    for its own reasons, which the pool entry page and the entrant's own
 *    breakdown do and the homepage module does not.
 *
 * The consequence, stated rather than discovered: on the homepage a standings
 * document that is behind the season data reads as fresh. That is the correct
 * trade. The recompute job is what keeps the pointer honest (it writes
 * episodes ascending and flips `latest_episode_num` last), the window is
 * minutes because the job triggers on the sync completing, and the alternative
 * is a season-document read on the highest-traffic public page in the product
 * to render a caption.
 */

// ---------------------------------------------------------------------------
// Document paths
// ---------------------------------------------------------------------------

/**
 * The standings document id for an episode.
 *
 * `episode_${string}` ids sort lexicographically, so `episode_10` precedes
 * `episode_2`. Nothing on this path asks Firestore for "the newest": from
 * episode 10 onward such a query would silently and permanently return
 * episode 9. The pointer on the config document plus a direct path is the
 * entire mitigation.
 */
export const poolStandingsDocId = (episodeNum: number): `episode_${string}` =>
  `episode_${episodeNum}`;

/** `pools/{poolId}/standings/{episodeId}` */
export const poolStandingsSummaryPath = (
  poolId: string,
  episodeNum: number,
): string => `pools/${poolId}/standings/${poolStandingsDocId(episodeNum)}`;

/** `pools/{poolId}/standings/{episodeId}/pages/{n}`, zero-based. */
export const poolStandingsPagePath = (
  poolId: string,
  episodeNum: number,
  page: number,
): string => `${poolStandingsSummaryPath(poolId, episodeNum)}/pages/${page}`;

// ---------------------------------------------------------------------------
// Fetch planner
// ---------------------------------------------------------------------------

export type PoolStandingsFetchReason =
  /** `display_mode` is not "full". The rollback lever, and it is checked first. */
  | "hidden"
  /** No pool for this season. */
  | "no-pool"
  /** The pool exists but nothing has been scored yet. */
  | "not-scored"
  /** A revision-matching browser-local copy is already in hand. */
  | "cached"
  /** One summary document, by direct path. */
  | "fetch";

export type PoolStandingsFetchPlan = {
  reason: PoolStandingsFetchReason;
  /** Document paths to read. Empty for every reason but "fetch". */
  paths: string[];
};

export type PoolStandingsFetchInput = {
  poolId?: PoolId | string;
  displayMode?: PoolDisplayMode;
  latestEpisodeNum?: number | null;
  /** True when the browser-local cache already holds this episode. */
  cacheHit?: boolean;
};

const NO_READ = (reason: PoolStandingsFetchReason): PoolStandingsFetchPlan => ({
  reason,
  paths: [],
});

/**
 * Which read, if any, the summary needs.
 *
 * `display_mode` is checked before anything else, deliberately. Without a
 * reader the field is inert, and hiding the leaderboard would then need a
 * Hosting rollback that also takes the entry page down with it. Checked first,
 * it is a switch an operator can throw in seconds with no deploy.
 */
export const planPoolStandingsFetch = (
  input: PoolStandingsFetchInput,
): PoolStandingsFetchPlan => {
  if (input.displayMode !== "full") return NO_READ("hidden");
  if (!input.poolId) return NO_READ("no-pool");

  const episodeNum = input.latestEpisodeNum;
  if (typeof episodeNum !== "number") return NO_READ("not-scored");
  if (input.cacheHit) return NO_READ("cached");

  return {
    reason: "fetch",
    paths: [poolStandingsSummaryPath(input.poolId, episodeNum)],
  };
};

export type PoolStandingsPagesFetchInput = PoolStandingsFetchInput & {
  /** `page_count` from the summary document already in hand. */
  pageCount?: number;
  /** True once a visitor has asked for the full list. */
  expanded?: boolean;
};

/**
 * Which overflow pages to read.
 *
 * Never before a visitor expands the list. The summary document is constant
 * in size whatever the entrant count, and egress rather than read count is the
 * binding constraint on a public surface (KTD6): fetching the full field for
 * every visitor is precisely the failure the split exists to avoid.
 */
export const planPoolStandingsPagesFetch = (
  input: PoolStandingsPagesFetchInput,
): { paths: string[] } => {
  if (input.displayMode !== "full") return { paths: [] };
  if (!input.poolId || !input.expanded) return { paths: [] };

  const episodeNum = input.latestEpisodeNum;
  if (typeof episodeNum !== "number") return { paths: [] };

  const pageCount = input.pageCount ?? 0;
  if (pageCount <= 0) return { paths: [] };

  return {
    paths: Array.from({ length: pageCount }, (_unused, page) =>
      poolStandingsPagePath(input.poolId as string, episodeNum, page),
    ),
  };
};

// ---------------------------------------------------------------------------
// Freshness resolver
// ---------------------------------------------------------------------------

/**
 * Three answers, and "zeroed" is deliberately not one of them (KTD8).
 *
 * Nobody recomputes in the browser: ranking needs every entrant's picks and
 * the rules keep entry documents readable only by their owner, so the browser
 * can never assemble a leaderboard. A stale document is therefore rendered
 * with its stamp, and an absent one renders the empty state. Rendering an
 * absent document as a field of zeroes would be a plausible-looking lie.
 */
export type PoolStandingsFreshness = "fresh" | "stale" | "missing";

export type PoolStandingsFreshnessInput = {
  standings: PoolStandingsStamp | undefined | null;
  /** `SCORING_REVISION`, a bundled constant. Always compared. */
  scoringRevision: string;
  /**
   * The season-data revision, compared only when supplied.
   *
   * Supply it ONLY from a surface that already reads the season document.
   * Omitting it is not a bug on the homepage, it is R22.
   */
  dataRevision?: string | null;
};

export const resolvePoolStandingsFreshness = ({
  standings,
  scoringRevision,
  dataRevision,
}: PoolStandingsFreshnessInput): PoolStandingsFreshness => {
  if (!standings) return "missing";
  if (standings.scoring_revision !== scoringRevision) return "stale";
  if (
    dataRevision !== undefined &&
    dataRevision !== null &&
    standings.data_revision !== dataRevision
  ) {
    return "stale";
  }
  return "fresh";
};

// ---------------------------------------------------------------------------
// Row projection (R17)
// ---------------------------------------------------------------------------

/**
 * A row as it may appear in public: handle, total points, rank. Nothing else.
 *
 * `prop_bet_points` is dropped along with everything else. It is a tiebreak
 * the job applies before serialization, not something the leaderboard shows,
 * and R17 lists three things.
 */
export type PublicStandingsRow = {
  handle: string;
  total: number;
  rank: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Narrow published rows to the three fields R17 permits.
 *
 * This is a projection rather than a pass-through so that no field can reach
 * the rendered output by being added upstream later. A row carrying a
 * castaway name, an elimination flag, a uid or an email address loses it here,
 * whatever wrote it. R25 bounds what a public pool surface may disclose and
 * says anything added later inherits that bound; this function is where the
 * bound is applied rather than remembered.
 *
 * A row whose three fields are not the right shape is dropped rather than
 * coerced. Half a row on a public leaderboard reads as a bug in the standings,
 * not as a bug in the payload.
 */
export const projectPoolStandingsRows = (
  rows: readonly unknown[] | undefined,
): PublicStandingsRow[] => {
  if (!Array.isArray(rows)) return [];
  const projected: PublicStandingsRow[] = [];
  for (const candidate of rows) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const { handle, total, rank } = candidate as Record<string, unknown>;
    if (typeof handle !== "string") continue;
    if (!isFiniteNumber(total)) continue;
    if (!isFiniteNumber(rank)) continue;
    projected.push({ handle, total, rank });
  }
  return projected;
};

// ---------------------------------------------------------------------------
// Shared ranks (KD4)
// ---------------------------------------------------------------------------

export type GroupedStandingsRow = {
  row: PublicStandingsRow;
  /** True for the first row of a run sharing a rank. */
  showRank: boolean;
  /** How many rows share this rank, including this one. */
  tiedCount: number;
};

/**
 * Annotate rows so a run of tied entrants reads as one shared position.
 *
 * Prop bets are the only tiebreak and they award points only when definitively
 * correct, so ties are the ordinary case in the first weeks rather than an
 * edge case (KD4). Fifteen rows each stamped "1" reads as a rendering fault;
 * one position with fifteen entrants under it reads as what happened.
 *
 * Order is preserved exactly. `rankPoolEntries` emits final published order,
 * including its deterministic uid tiebreak, and re-sorting here would make
 * tied rows visibly reshuffle between visits.
 */
export const groupPoolStandingsRows = (
  rows: readonly PublicStandingsRow[],
): GroupedStandingsRow[] => {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.rank, (counts.get(row.rank) ?? 0) + 1);
  }
  let previousRank: number | null = null;
  return rows.map((row) => {
    const showRank = row.rank !== previousRank;
    previousRank = row.rank;
    return { row, showRank, tiedCount: counts.get(row.rank) ?? 1 };
  });
};

// ---------------------------------------------------------------------------
// View resolver
// ---------------------------------------------------------------------------

export type PoolStandingsEmptyReason =
  /** The config resolved and there is no pool for this season. */
  | "no-pool"
  /** A pool exists, but no episode has been scored yet. */
  | "not-scored"
  /** The pointer names an episode whose document is not there (KTD8). */
  | "absent";

export type PoolStandingsReadyView = {
  kind: "ready";
  freshness: "fresh" | "stale";
  episodeNum: number;
  computedAt: string;
  /** Entrants in the pool as of this run, from the summary document. */
  entryCount: number;
  /** Already projected to handle, total and rank. */
  rows: PublicStandingsRow[];
  /** How many rows exist in total, so "show all" can name a number. */
  totalRows: number;
  pageCount: number;
  seasonComplete: boolean;
};

export type PoolStandingsView =
  | { kind: "hidden" }
  | { kind: "pending" }
  | { kind: "empty"; reason: PoolStandingsEmptyReason }
  | PoolStandingsReadyView;

export type PoolStandingsViewInput = {
  pool: Pool | undefined;
  /** False while the config read is still in flight. */
  poolLoaded: boolean;
  summary: PoolStandings | undefined;
  /** False while the summary read is still in flight. */
  summaryLoaded: boolean;
  /** Overflow pages, in any order. Present only once a visitor expanded. */
  pages?: PoolStandingsPage[];
  scoringRevision: string;
  /** Omitted by the homepage. See the module header. */
  dataRevision?: string | null;
};

/**
 * What is on screen, given what came back.
 *
 * Order matters here as much as it does in the planner. `display_mode` is
 * checked before the pointer so the lever works in every state; "pending"
 * comes before "empty" so a cold load never flashes an empty leaderboard at a
 * visitor while a read is in flight.
 */
export const resolvePoolStandingsView = ({
  pool,
  poolLoaded,
  summary,
  summaryLoaded,
  pages,
  scoringRevision,
  dataRevision,
}: PoolStandingsViewInput): PoolStandingsView => {
  if (pool && pool.display_mode !== "full") return { kind: "hidden" };
  if (!poolLoaded) return { kind: "pending" };
  if (!pool) return { kind: "empty", reason: "no-pool" };
  if (pool.display_mode !== "full") return { kind: "hidden" };
  if (typeof pool.latest_episode_num !== "number") {
    return { kind: "empty", reason: "not-scored" };
  }
  if (!summaryLoaded) return { kind: "pending" };

  const freshness = resolvePoolStandingsFreshness({
    standings: summary,
    scoringRevision,
    dataRevision,
  });
  if (freshness === "missing" || !summary) {
    // Never a field of zeroes. There is no browser fallback for anyone,
    // signed in or not, so an absent document is the end of the road (KTD8).
    return { kind: "empty", reason: "absent" };
  }

  // Pages carry the whole field from row one, so an expanded list is the
  // pages in page order rather than the summary with pages appended.
  const expandedRows =
    pages && pages.length > 0
      ? [...pages]
          .sort((a, b) => a.page - b.page)
          .flatMap((page) => projectPoolStandingsRows(page.rows))
      : null;

  return {
    kind: "ready",
    freshness,
    episodeNum: summary.episode_num,
    computedAt: summary.computed_at,
    entryCount: summary.entry_count,
    rows: expandedRows ?? projectPoolStandingsRows(summary.rows),
    totalRows: summary.entry_count,
    pageCount: summary.page_count ?? 0,
    seasonComplete: pool.season_complete === true,
  };
};

// ---------------------------------------------------------------------------
// As-of copy
// ---------------------------------------------------------------------------

export type PoolStandingsAsOf = {
  /** The caption above the leaderboard. */
  label: string;
  /** Present only when the totals need explaining. */
  note?: string;
};

/**
 * The as-of stamp, in words.
 *
 * R25 accepts that naming an episode number discloses how many episodes have
 * aired and that a completed season announces itself. Nothing beyond that is
 * said here: no castaway, no elimination, no per-castaway breakdown.
 *
 * The stale wording is the important one. A visitor looking at totals that
 * have not caught up should be told they are the last published ones rather
 * than left to conclude the leaderboard is broken, and a handle changed after
 * the freeze appears here at the next refresh for the same reason (KTD5).
 */
export const describePoolStandingsAsOf = (
  view: Pick<
    PoolStandingsReadyView,
    "freshness" | "episodeNum" | "seasonComplete"
  >,
): PoolStandingsAsOf => {
  const label = view.seasonComplete
    ? "Final standings"
    : `Standings as of episode ${view.episodeNum}`;

  if (view.freshness === "stale") {
    return {
      label,
      note: "Newer data has landed since these were worked out. These are the last published totals, and they refresh at the next update.",
    };
  }
  return { label };
};

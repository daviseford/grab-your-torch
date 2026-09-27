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
 * A row as it may appear in public: handle, rank and three point figures.
 * Nothing else.
 *
 * `total` is castaway points plus awarded prop bet points, and it is what the
 * leaderboard ranks on. `castawayPoints` and `propBetPoints` break it down;
 * they are already inside `total` and are shown beside it, never added to it.
 * `propBetPoints` counts only bets that have definitively settled in the
 * entrant's favour: pending and "leading" bets award nothing
 * (`getPropBetScoresForUser`), so an unresolved bet never shows up here. No
 * bet name, answer, event or castaway travels with it, and the payload has
 * none to offer.
 */
export type PublicStandingsRow = {
  handle: string;
  total: number;
  rank: number;
  /** Absent when the published row has no usable value. */
  castawayPoints?: number;
  /** Absent when the published row has no usable value. */
  propBetPoints?: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPoints = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;

/**
 * Narrow published rows to the fields the public bound permits.
 *
 * This is a projection rather than a pass-through so that no field can reach
 * the rendered output by being added upstream later. A row carrying a
 * castaway name, an elimination flag, a uid or an email address loses it here,
 * whatever wrote it. R25 bounds what a public pool surface may disclose and
 * says anything added later inherits that bound; this function is where the
 * bound is applied rather than remembered.
 *
 * TWO PUBLISHED SHAPES. A row carrying `castaway_points` is current: its
 * `total` already includes prop bet points. A row without it was published
 * before that change, when `total` held castaway points only, and it stays
 * readable until the recompute job next republishes every episode. For such a
 * row the total is rebuilt as `total + prop_bet_points` here, once, so the
 * leaderboard shows the same number either way and nothing downstream has to
 * know which shape it read. A legacy row with no usable prop bet value keeps
 * its castaway-only total and shows no prop bet cell.
 *
 * A row whose handle, total or rank is not the right shape is dropped rather
 * than coerced. Half a row on a public leaderboard reads as a bug in the
 * standings, not as a bug in the payload. A bad breakdown value loses only
 * its own cell.
 */
export const projectPoolStandingsRows = (
  rows: readonly unknown[] | undefined,
): PublicStandingsRow[] => {
  if (!Array.isArray(rows)) return [];
  const projected: PublicStandingsRow[] = [];
  for (const candidate of rows) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const {
      handle,
      total,
      rank,
      castaway_points: castawayPoints,
      prop_bet_points: propBetPoints,
    } = candidate as Record<string, unknown>;
    if (typeof handle !== "string") continue;
    if (!isFiniteNumber(total)) continue;
    if (!isFiniteNumber(rank)) continue;

    const row: PublicStandingsRow = { handle, total, rank };
    if (isPoints(castawayPoints)) {
      row.castawayPoints = castawayPoints;
      if (isPoints(propBetPoints)) row.propBetPoints = propBetPoints;
    } else if (!("castaway_points" in candidate)) {
      // Legacy shape: `total` is castaway points only.
      row.castawayPoints = total;
      if (isPoints(propBetPoints)) {
        row.propBetPoints = propBetPoints;
        row.total = total + propBetPoints;
      }
    }
    projected.push(row);
  }
  return projected;
};

// ---------------------------------------------------------------------------
// Shared ranks (KD4)
// ---------------------------------------------------------------------------

export type GroupedStandingsRow = {
  row: PublicStandingsRow;
  /** True for the first row of a run sharing a total. */
  showRank: boolean;
  /** How many rows share this total, including this one. */
  tiedCount: number;
  /**
   * The position shown to people: 1 for the highest total, 2 for the next
   * distinct total, and so on. A tie takes one position, not one per entrant.
   */
  position: number;
  /** What the rank column says: "7", or "T-7" on every row of a tie. */
  label: string;
};

/**
 * Number the rows as people read them: by the total they can see.
 *
 * TIES ARE DECIDED BY THE TOTAL: castaway points plus awarded prop bet points.
 * Entrants on the same total share a position, and every one of them is
 * labelled "T-" plus that position. Current documents publish a `rank` that
 * agrees (`rankPoolEntries`), but legacy documents published a rank that broke
 * ties on prop bets over a castaway-only total, so positions are always
 * counted here from `total` rather than read from `rank`. Inside a tie, rows
 * keep the published order (prop bet points, then the uid).
 *
 * Positions are dense: the total after a tie is the next number, so four
 * entrants at T-5 are followed by 6, not 9.
 *
 * Ties are the ordinary case in the first weeks rather than an edge case
 * (KD4), which is why every row carries its position rather than only the
 * first row of a run.
 *
 * Rows always start from row one of the published order (the summary, or the
 * pages from page zero), so counting positions over them is exact. The one
 * blind spot is a tie that straddles the end of the rows in hand: the last row
 * shown cannot see its partner on an unfetched page and reads as untied until
 * the list is expanded.
 *
 * The only reordering is a stable sort by total, which is a no-op on current
 * documents. On a legacy summary it can only reorder the rows in hand: a row
 * past the summary whose rebuilt total would rank higher stays on its page
 * until the list is expanded or the job republishes.
 */
export const groupPoolStandingsRows = (
  published: readonly PublicStandingsRow[],
): GroupedStandingsRow[] => {
  // Current documents are already in this order and a stable sort leaves them
  // alone. Legacy documents were ordered by castaway points, and their totals
  // are rebuilt on read, so this is what puts them in total order.
  const rows = [...published].sort((a, b) => b.total - a.total);
  // A tie is now a run of equal totals.
  const runLengths: number[] = [];
  rows.forEach((row, index) => {
    if (index > 0 && rows[index - 1].total === row.total) {
      runLengths[runLengths.length - 1] += 1;
    } else {
      runLengths.push(1);
    }
  });

  let position = 0;
  return rows.map((row, index) => {
    const showRank = index === 0 || rows[index - 1].total !== row.total;
    if (showRank) position += 1;
    const tiedCount = runLengths[position - 1];
    return {
      row,
      showRank,
      tiedCount,
      position,
      label: tiedCount > 1 ? `T-${position}` : `${position}`,
    };
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

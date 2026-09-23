import type { CastawayId, Season } from "../types";

/**
 * Average draft position (ADP): where a castaway tends to go in a draft,
 * as the mean one-based OVERALL pick number across a cohort of drafts.
 *
 * Overall pick, not round and not roster slot: in a 4-person snake draft the
 * first pick of round two is pick 5, whoever makes it. That is exactly what
 * `DraftPick.order` stores, because a pick is written at the draft's
 * `current_pick_number`, which starts at 1 when the draft starts.
 *
 * The cohort is every promoted draft for a season (one `competitions` doc
 * each) that was finished before the premiere broadcast. The rest of this
 * module is pure so the admin job and the tests share one definition; the
 * published summary is read by the draft page and nothing else.
 */

/** Firestore collection holding one published summary per season. */
export const CASTAWAY_ADP_COLLECTION = "castaway_adp";

/**
 * Fewer eligible drafts than this and no per-castaway numbers are published:
 * two drafts make an average that is really one group's picks, and derived
 * stats over tiny samples mislead.
 */
export const MIN_ADP_DRAFTS = 3;

/** Stable name for the cohort, stored on the summary so readers can label it. */
export const ADP_COHORT = "pre_premiere_completed_drafts" as const;

export type CastawayAdpStat = {
  /** Mean one-based overall pick, unrounded. */
  adp: number;
  /** Drafts in the cohort that picked this castaway. */
  picks: number;
  /** Earliest overall pick this castaway went at. */
  best: number;
  /** Latest overall pick this castaway went at. */
  worst: number;
};

/** The document at `castaway_adp/{season_id}`. Aggregates only, no people. */
export type CastawayAdpSummary = {
  season_id: Season["id"];
  season_num: number;
  cohort: typeof ADP_COHORT;
  /** Eligible drafts. Castaways missing from `castaways` went undrafted in all of them. */
  draft_count: number;
  /** Threshold in force when computed; below it `castaways` is empty. */
  min_drafts: number;
  /** ISO instant; only drafts promoted strictly before it count. */
  premiere_cutoff: string;
  computed_at: string;
  castaways: Partial<Record<CastawayId, CastawayAdpStat>>;
};

/** One `competitions` doc as the job reads it. */
export type AdpCompetitionSource = {
  id: string;
  /** When the doc was first written, i.e. when the draft was promoted. */
  createdAt: Date | null;
  data: Record<string, unknown>;
};

export const ADP_EXCLUSION_REASONS = [
  "fixture",
  "unknown_creation_time",
  "after_premiere",
  "invalid_picks",
] as const;

export type AdpExclusionReason = (typeof ADP_EXCLUSION_REASONS)[number];

export type AdpPlan = {
  summary: CastawayAdpSummary;
  /** Counts only, never ids: the job's log may be public. */
  excluded: Record<AdpExclusionReason, number>;
  /** False when the cohort is below `MIN_ADP_DRAFTS` and numbers are withheld. */
  published: boolean;
};

/**
 * The instant a season's premiere becomes watchable anywhere, from its air
 * date (YYYY-MM-DD). Survivor premieres at 8 PM Eastern, which is 00:00 UTC
 * the next day under daylight time and 01:00 UTC under standard time, so
 * next-day midnight UTC is never later than the broadcast.
 */
export const premiereCutoff = (airDate: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(airDate)) {
    throw new Error(`Premiere air date must be YYYY-MM-DD, got "${airDate}"`);
  }
  const cutoff = new Date(`${airDate}T00:00:00Z`);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Premiere air date "${airDate}" is not a real date`);
  }
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  return cutoff;
};

/** Test and sample data carry one of these markers; see the seeding scripts. */
const isFixture = (data: Record<string, unknown>) =>
  data.sample_fixture === true || data.e2e_fixture === true;

type ValidPick = { order: number; castaway_id: CastawayId };

/**
 * The draft's picks, if they form one complete snake draft for this season:
 * overall picks 1..N with no gaps or repeats, each a distinct castaway from
 * the season's cast, and N an exact multiple of the participant count.
 * Anything else is an incomplete or damaged draft and is skipped whole
 * rather than partly counted.
 */
const validPicks = (
  data: Record<string, unknown>,
  seasonId: Season["id"],
  cast: ReadonlySet<CastawayId>,
): ValidPick[] | null => {
  const raw = data.draft_picks;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const participants = Array.isArray(data.participant_uids)
    ? data.participant_uids.length
    : 0;
  if (participants === 0 || raw.length % participants !== 0) return null;

  const picks: ValidPick[] = [];
  for (const pick of raw as Record<string, unknown>[]) {
    if (!pick || typeof pick !== "object") return null;
    const { order, castaway_id, season_id } = pick;
    if (typeof order !== "number" || !Number.isInteger(order)) return null;
    if (typeof castaway_id !== "string" || !cast.has(castaway_id as CastawayId))
      return null;
    if (season_id !== undefined && season_id !== seasonId) return null;
    picks.push({ order, castaway_id: castaway_id as CastawayId });
  }

  picks.sort((a, b) => a.order - b.order);
  const seen = new Set<CastawayId>();
  for (const [index, pick] of picks.entries()) {
    if (pick.order !== index + 1 || seen.has(pick.castaway_id)) return null;
    seen.add(pick.castaway_id);
  }
  return picks;
};

export type AdpPlanInput = {
  seasonId: Season["id"];
  seasonNum: number;
  /** Every castaway id in the season's cast. */
  castawayIds: readonly CastawayId[];
  /** Premiere air date, YYYY-MM-DD. */
  premiereAirDate: string;
  /** Competitions of any season; other seasons are ignored. */
  competitions: readonly AdpCompetitionSource[];
  computedAt: string;
  minDrafts?: number;
};

/**
 * Build the published summary for one season.
 *
 * Reads only each competition's own `draft_picks`, the copy frozen when the
 * draft was promoted. Trades live in a subcollection and move ownership
 * without touching those picks, so they are never an input here.
 */
export const planCastawayAdp = ({
  seasonId,
  seasonNum,
  castawayIds,
  premiereAirDate,
  competitions,
  computedAt,
  minDrafts = MIN_ADP_DRAFTS,
}: AdpPlanInput): AdpPlan => {
  const cutoff = premiereCutoff(premiereAirDate);
  const cast = new Set(castawayIds);
  const excluded = Object.fromEntries(
    ADP_EXCLUSION_REASONS.map((reason) => [reason, 0]),
  ) as Record<AdpExclusionReason, number>;

  const totals = new Map<
    CastawayId,
    { sum: number; picks: number; best: number; worst: number }
  >();
  let draftCount = 0;

  for (const competition of competitions) {
    if (competition.data.season_id !== seasonId) continue;

    if (isFixture(competition.data)) {
      excluded.fixture += 1;
      continue;
    }
    if (
      !competition.createdAt ||
      Number.isNaN(competition.createdAt.getTime())
    ) {
      excluded.unknown_creation_time += 1;
      continue;
    }
    if (competition.createdAt.getTime() >= cutoff.getTime()) {
      excluded.after_premiere += 1;
      continue;
    }
    const picks = validPicks(competition.data, seasonId, cast);
    if (!picks) {
      excluded.invalid_picks += 1;
      continue;
    }

    draftCount += 1;
    for (const { order, castaway_id } of picks) {
      const total = totals.get(castaway_id);
      if (total) {
        total.sum += order;
        total.picks += 1;
        total.best = Math.min(total.best, order);
        total.worst = Math.max(total.worst, order);
      } else {
        totals.set(castaway_id, {
          sum: order,
          picks: 1,
          best: order,
          worst: order,
        });
      }
    }
  }

  const published = draftCount >= minDrafts;
  const castaways: CastawayAdpSummary["castaways"] = {};
  if (published) {
    for (const [id, total] of totals) {
      castaways[id] = {
        adp: total.sum / total.picks,
        picks: total.picks,
        best: total.best,
        worst: total.worst,
      };
    }
  }

  return {
    summary: {
      season_id: seasonId,
      season_num: seasonNum,
      cohort: ADP_COHORT,
      draft_count: draftCount,
      min_drafts: minDrafts,
      premiere_cutoff: cutoff.toISOString(),
      computed_at: computedAt,
      castaways,
    },
    excluded,
    published,
  };
};

/* ------------------------------------------------------------------ *
 * Reading a published summary
 * ------------------------------------------------------------------ */

/** One decimal: enough to separate neighbours without implying precision. */
export const formatAdp = (adp: number): string => adp.toFixed(1);

/**
 * A summary read back from Firestore, or null when it is absent or not the
 * shape this code publishes. Readers treat null as "no data", never as zero.
 */
export const parseCastawayAdpSummary = (
  raw: unknown,
): CastawayAdpSummary | null => {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Partial<CastawayAdpSummary>;
  if (
    doc.cohort !== ADP_COHORT ||
    typeof doc.draft_count !== "number" ||
    typeof doc.min_drafts !== "number" ||
    typeof doc.computed_at !== "string" ||
    !doc.castaways ||
    typeof doc.castaways !== "object"
  ) {
    return null;
  }
  return doc as CastawayAdpSummary;
};

export type CastawayAdpState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "too_few"; draftCount: number; minDrafts: number }
  | { kind: "ready"; summary: CastawayAdpSummary };

export const castawayAdpState = (
  loaded: boolean,
  summary: CastawayAdpSummary | null,
): CastawayAdpState => {
  if (!loaded) return { kind: "loading" };
  if (!summary) return { kind: "unavailable" };
  if (
    summary.draft_count < summary.min_drafts ||
    Object.keys(summary.castaways).length === 0
  ) {
    return {
      kind: "too_few",
      draftCount: summary.draft_count,
      minDrafts: summary.min_drafts,
    };
  }
  return { kind: "ready", summary };
};

/**
 * Order castaways earliest ADP first. Castaways nobody in the cohort drafted
 * come last, then ties fall back to the caller's existing order (the cast
 * grid's alphabetical order), so the sort is stable and spoiler-neutral.
 */
export const sortByAdp = <T extends { castaway_id: CastawayId }>(
  players: readonly T[],
  castaways: CastawayAdpSummary["castaways"],
): T[] =>
  players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const adpA = castaways[a.player.castaway_id]?.adp ?? Infinity;
      const adpB = castaways[b.player.castaway_id]?.adp ?? Infinity;
      if (adpA !== adpB) return adpA < adpB ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ player }) => player);

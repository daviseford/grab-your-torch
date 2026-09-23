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
 * Two cohorts are published per season, each as its own document:
 *
 * - `pre_premiere` (the default everywhere): drafts saved as a competition
 *   before the premiere aired. Picks made then cannot reflect the show.
 * - `all_drafts`: every qualifying draft, including ones made after episodes
 *   aired. It can encode results, so readers show it only after an explicit
 *   opt-in with a spoiler warning.
 *
 * The rest of this module is pure so the admin job and the tests share one
 * definition; the published summaries are read by the draft page only.
 */

/** Firestore collection holding the published summaries. */
export const CASTAWAY_ADP_COLLECTION = "castaway_adp";

export const ADP_COHORTS = ["pre_premiere", "all_drafts"] as const;
export type AdpCohort = (typeof ADP_COHORTS)[number];

/** `castaway_adp/{season_id}_{cohort}`: one document per season and cohort. */
export const castawayAdpDocId = (seasonId: Season["id"], cohort: AdpCohort) =>
  `${seasonId}_${cohort}`;

/**
 * A castaway's average is published only when at least this many qualifying
 * drafts picked them, made by at least `MIN_ADP_CREATORS` different people.
 * Below that, one group's picks could be read back out of the average. The
 * thresholds reduce what can be inferred; they do not make inference
 * impossible.
 */
export const MIN_ADP_DRAFTS = 10;
export const MIN_ADP_CREATORS = 5;

export type CastawayAdpStat = {
  /** Mean one-based overall pick, unrounded. */
  adp: number;
  /** Qualifying drafts that picked this castaway. */
  picks: number;
};

/**
 * The document at `castaway_adp/{season_id}_{cohort}`. Aggregates only: no
 * uid, name, competition, or draft id, and no per-draft extremes.
 */
export type CastawayAdpSummary = {
  season_id: Season["id"];
  season_num: number;
  cohort: AdpCohort;
  /** Qualifying drafts. A castaway absent from `castaways` is below the thresholds. */
  draft_count: number;
  /**
   * `pre_premiere` only: qualifying drafts whose competition record has not
   * changed at all since before the premiere. The others were matched
   * against their original draft record instead. Null for `all_drafts`.
   */
  sealed_count: number | null;
  min_drafts: number;
  min_creators: number;
  /** `pre_premiere` only: drafts saved strictly before this instant count. */
  premiere_cutoff: string | null;
  computed_at: string;
  castaways: Partial<Record<CastawayId, CastawayAdpStat>>;
};

/**
 * One `competitions` doc as the admin job reads it, joined to the Realtime
 * Database draft it was promoted from. Both documents are written by
 * clients, so neither is trusted alone: the Firestore timestamps are set by
 * the server, and account creation times come from Firebase Auth.
 */
export type AdpCompetitionSource = {
  id: string;
  /** Server time the doc was first written, i.e. when the draft was promoted. */
  createdAt: Date | null;
  /** Server time of the doc's latest write of any kind. */
  updatedAt: Date | null;
  data: Record<string, unknown>;
  /** `drafts/{draft_id}` from the Realtime Database; null when absent. */
  sourceDraft: Record<string, unknown> | null;
};

/** Firebase Auth creation time per participant uid, from the Admin SDK. */
export type AdpAccounts = ReadonlyMap<string, Date>;

export const ADP_EXCLUSION_REASONS = [
  "fixture",
  "unknown_creation_time",
  "after_premiere",
  "solo",
  "invalid_picks",
  "no_source_draft",
  "source_mismatch",
  "unverified_participants",
  "duplicate",
] as const;

export type AdpExclusionReason = (typeof ADP_EXCLUSION_REASONS)[number];

export type AdpPlan = {
  summary: CastawayAdpSummary;
  /** Counts only, never ids: the job's log may be public. */
  excluded: Record<AdpExclusionReason, number>;
  /** Castaways with a draft count but below the thresholds, withheld. */
  withheld: number;
  /** True when at least one castaway's average is published. */
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

const isValidDate = (date: Date | null): date is Date =>
  !!date && !Number.isNaN(date.getTime());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The Realtime Database stores lists as objects keyed by index (or as sparse
 * arrays). Values in key order, holes dropped.
 */
const rtdbList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.filter((item) => item != null);
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, item]) => item)
    .filter((item) => item != null);
};

type ValidPick = { order: number; castaway_id: CastawayId; user_uid: string };

/**
 * The competition's distinct participant uids, or null unless there are at
 * least two and the list has no repeats. A draft needs two people to start.
 */
const competitionParticipants = (
  data: Record<string, unknown>,
): string[] | null => {
  const raw = data.participant_uids;
  if (!Array.isArray(raw)) return null;
  if (!raw.every((uid) => typeof uid === "string" && uid.length > 0))
    return null;
  const uids = raw as string[];
  if (new Set(uids).size !== uids.length || uids.length < 2) return null;
  return uids;
};

/**
 * Picks as a complete draft for this season: overall picks 1..N with no gaps
 * or repeats, each a distinct castaway from the season's cast, made by a
 * participant, N a multiple of the participant count, and every participant
 * holding the same number. Anything else is skipped whole, never partly
 * counted.
 */
const validPicks = (
  raw: unknown,
  seasonId: Season["id"],
  cast: ReadonlySet<CastawayId>,
  participants: readonly string[],
): ValidPick[] | null => {
  const list = rtdbList(raw);
  if (list.length === 0 || list.length % participants.length !== 0) return null;

  const members = new Set(participants);
  const perMember = new Map<string, number>();
  const picks: ValidPick[] = [];
  for (const pick of list) {
    if (!isRecord(pick)) return null;
    const { order, castaway_id, season_id, user_uid } = pick;
    if (typeof order !== "number" || !Number.isInteger(order)) return null;
    if (typeof castaway_id !== "string" || !cast.has(castaway_id as CastawayId))
      return null;
    if (season_id !== undefined && season_id !== seasonId) return null;
    if (typeof user_uid !== "string" || !members.has(user_uid)) return null;
    perMember.set(user_uid, (perMember.get(user_uid) ?? 0) + 1);
    picks.push({ order, castaway_id: castaway_id as CastawayId, user_uid });
  }

  const each = list.length / participants.length;
  if (
    perMember.size !== participants.length ||
    [...perMember.values()].some((count) => count !== each)
  ) {
    return null;
  }

  picks.sort((a, b) => a.order - b.order);
  const seen = new Set<CastawayId>();
  for (const [index, pick] of picks.entries()) {
    if (pick.order !== index + 1 || seen.has(pick.castaway_id)) return null;
    seen.add(pick.castaway_id);
  }
  return picks;
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === a.length;

/**
 * Whether the Realtime Database draft is the one this competition was
 * promoted from, finished, with the same people and the same picks in the
 * same slots. Once a draft finishes its picks can no longer be written by
 * any client, so a competition whose picks were edited later stops matching.
 */
const matchesSourceDraft = (
  competition: AdpCompetitionSource,
  seasonId: Season["id"],
  participants: readonly string[],
  picks: readonly ValidPick[],
  cast: ReadonlySet<CastawayId>,
): boolean => {
  const source = competition.sourceDraft;
  if (!isRecord(source)) return false;
  const { data } = competition;

  if (source.id !== data.draft_id) return false;
  if (source.season_id !== seasonId) return false;
  if (source.creator_uid !== data.creator_uid) return false;
  if (
    source.competiton_id !== undefined &&
    source.competiton_id !== competition.id
  )
    return false;

  const state = isRecord(source.state) ? source.state : {};
  if (state.finished !== true && source.finished !== true) return false;

  const sourceParticipants = rtdbList(source.participants).map((person) =>
    isRecord(person) ? person.uid : undefined,
  );
  if (
    !sourceParticipants.every((uid): uid is string => typeof uid === "string")
  )
    return false;
  if (!sameSet(sourceParticipants, participants)) return false;

  const sourcePicks = validPicks(
    source.draft_picks,
    seasonId,
    cast,
    participants,
  );
  if (!sourcePicks || sourcePicks.length !== picks.length) return false;
  if (
    sourcePicks.some(
      (pick, index) =>
        pick.castaway_id !== picks[index].castaway_id ||
        pick.user_uid !== picks[index].user_uid,
    )
  )
    return false;

  // Drafts started since turn maps existed record whose turn each pick was;
  // a pick credited to anyone else was not made through the draft.
  const turns = source.turns;
  if (isRecord(turns) && Object.keys(turns).length > 0) {
    if (picks.some((pick) => turns[String(pick.order)] !== pick.user_uid))
      return false;
  }
  return true;
};

export type AdpPlanInput = {
  seasonId: Season["id"];
  seasonNum: number;
  cohort: AdpCohort;
  /** Every castaway id in the season's cast. */
  castawayIds: readonly CastawayId[];
  /** Premiere air date, YYYY-MM-DD. Required for `pre_premiere`. */
  premiereAirDate: string | null;
  /** Competitions of any season; other seasons are ignored. */
  competitions: readonly AdpCompetitionSource[];
  accounts: AdpAccounts;
  computedAt: string;
  minDrafts?: number;
  minCreators?: number;
};

/**
 * Build one cohort's published summary for one season.
 *
 * Reads only each competition's own `draft_picks`, the copy frozen when the
 * draft was promoted. Trades live in a subcollection and move ownership
 * without touching those picks, so they are never an input here.
 */
export const planCastawayAdp = ({
  seasonId,
  seasonNum,
  cohort,
  castawayIds,
  premiereAirDate,
  competitions,
  accounts,
  computedAt,
  minDrafts = MIN_ADP_DRAFTS,
  minCreators = MIN_ADP_CREATORS,
}: AdpPlanInput): AdpPlan => {
  const cutoff = premiereAirDate ? premiereCutoff(premiereAirDate) : null;
  if (cohort === "pre_premiere" && !cutoff) {
    throw new Error("The pre-premiere cohort needs a premiere air date");
  }
  const cast = new Set(castawayIds);
  const excluded = Object.fromEntries(
    ADP_EXCLUSION_REASONS.map((reason) => [reason, 0]),
  ) as Record<AdpExclusionReason, number>;

  type Candidate = {
    createdAt: Date;
    sealed: boolean;
    creator: string;
    participants: string[];
    picks: ValidPick[];
  };
  const candidates: Candidate[] = [];

  for (const competition of competitions) {
    const { data } = competition;
    if (data.season_id !== seasonId) continue;

    if (isFixture(data)) {
      excluded.fixture += 1;
      continue;
    }
    if (!isValidDate(competition.createdAt)) {
      excluded.unknown_creation_time += 1;
      continue;
    }
    const createdAt = competition.createdAt;
    if (cohort === "pre_premiere" && createdAt.getTime() >= cutoff!.getTime()) {
      excluded.after_premiere += 1;
      continue;
    }
    const participants = competitionParticipants(data);
    if (!participants) {
      excluded.solo += 1;
      continue;
    }
    const picks = validPicks(data.draft_picks, seasonId, cast, participants);
    if (!picks) {
      excluded.invalid_picks += 1;
      continue;
    }
    if (!competition.sourceDraft) {
      excluded.no_source_draft += 1;
      continue;
    }
    if (!matchesSourceDraft(competition, seasonId, participants, picks, cast)) {
      excluded.source_mismatch += 1;
      continue;
    }
    // Every participant must be a real account that existed before the
    // competition was saved. Both times are set by Firebase, not a client.
    if (
      participants.some((uid) => {
        const created = accounts.get(uid);
        return !created || created.getTime() > createdAt.getTime();
      })
    ) {
      excluded.unverified_participants += 1;
      continue;
    }

    candidates.push({
      createdAt,
      sealed:
        !!cutoff &&
        isValidDate(competition.updatedAt) &&
        competition.updatedAt.getTime() < cutoff.getTime(),
      creator: data.creator_uid as string,
      participants,
      picks,
    });
  }

  // The same people drafting twice, or one creator repeating a board, count
  // once: the earliest saved copy stands.
  candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seenGroups = new Set<string>();
  const seenBoards = new Set<string>();
  const totals = new Map<
    CastawayId,
    { sum: number; picks: number; creators: Set<string> }
  >();
  let draftCount = 0;
  let sealedCount = 0;

  for (const candidate of candidates) {
    const group = [...candidate.participants].sort().join("\n");
    const board = `${candidate.creator}\n${candidate.picks.map((pick) => pick.castaway_id).join(",")}`;
    if (seenGroups.has(group) || seenBoards.has(board)) {
      excluded.duplicate += 1;
      continue;
    }
    seenGroups.add(group);
    seenBoards.add(board);

    draftCount += 1;
    if (candidate.sealed) sealedCount += 1;
    for (const { order, castaway_id } of candidate.picks) {
      const total = totals.get(castaway_id) ?? {
        sum: 0,
        picks: 0,
        creators: new Set<string>(),
      };
      total.sum += order;
      total.picks += 1;
      total.creators.add(candidate.creator);
      totals.set(castaway_id, total);
    }
  }

  const castaways: CastawayAdpSummary["castaways"] = {};
  let withheld = 0;
  for (const [id, total] of totals) {
    if (total.picks >= minDrafts && total.creators.size >= minCreators) {
      castaways[id] = { adp: total.sum / total.picks, picks: total.picks };
    } else {
      withheld += 1;
    }
  }

  return {
    summary: {
      season_id: seasonId,
      season_num: seasonNum,
      cohort,
      draft_count: draftCount,
      sealed_count: cohort === "pre_premiere" ? sealedCount : null,
      min_drafts: minDrafts,
      min_creators: minCreators,
      premiere_cutoff: cohort === "pre_premiere" ? cutoff!.toISOString() : null,
      computed_at: computedAt,
      castaways,
    },
    excluded,
    withheld,
    published: Object.keys(castaways).length > 0,
  };
};

/**
 * A summary's content apart from when it was computed, in a stable key order,
 * so a rerun over unchanged data can be recognised and skipped.
 */
export const adpSummaryFingerprint = (summary: unknown): string => {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  };
  if (!isRecord(summary)) return JSON.stringify(summary ?? null);
  const content = { ...summary };
  delete content.computed_at;
  return JSON.stringify(stable(content));
};

/* ------------------------------------------------------------------ *
 * Reading a published summary
 * ------------------------------------------------------------------ */

/** One decimal: enough to separate neighbours without implying precision. */
export const formatAdp = (adp: number): string => adp.toFixed(1);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isInstant = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * One castaway's stat, or null when it is not a shape this code publishes.
 * An average of overall picks can be no lower than 1 and no higher than the
 * largest possible pick, and a castaway can be picked at most once a draft.
 */
const parseStat = (
  raw: unknown,
  draftCount: number,
): CastawayAdpStat | null => {
  if (!isRecord(raw)) return null;
  const { adp, picks } = raw;
  if (typeof adp !== "number" || !Number.isFinite(adp) || adp < 1) return null;
  if (!isCount(picks) || picks < 1 || picks > draftCount) return null;
  return { adp, picks };
};

/**
 * A summary read back from Firestore, or null when it is absent, of another
 * cohort, or not the shape this code publishes. Readers treat null as "no
 * data", never as zero. Individually malformed castaway entries are dropped
 * rather than failing the whole summary.
 */
export const parseCastawayAdpSummary = (
  raw: unknown,
  cohort: AdpCohort,
): CastawayAdpSummary | null => {
  if (!isRecord(raw)) return null;
  const {
    season_id,
    season_num,
    draft_count,
    sealed_count,
    min_drafts,
    min_creators,
    premiere_cutoff,
    computed_at,
    castaways,
  } = raw;
  if (raw.cohort !== cohort) return null;
  if (typeof season_id !== "string" || !/^season_\d+$/.test(season_id))
    return null;
  if (!isCount(season_num) || !isCount(draft_count)) return null;
  if (!isCount(min_drafts) || !isCount(min_creators)) return null;
  if (!isInstant(computed_at) || !isRecord(castaways)) return null;
  if (cohort === "pre_premiere") {
    if (!isInstant(premiere_cutoff)) return null;
    if (!isCount(sealed_count) || sealed_count > draft_count) return null;
  }

  const parsed: CastawayAdpSummary["castaways"] = {};
  for (const [id, value] of Object.entries(castaways)) {
    const stat = parseStat(value, draft_count);
    if (stat) parsed[id as CastawayId] = stat;
  }

  return {
    season_id: season_id as Season["id"],
    season_num,
    cohort,
    draft_count,
    sealed_count: cohort === "pre_premiere" ? (sealed_count as number) : null,
    min_drafts,
    min_creators,
    premiere_cutoff:
      cohort === "pre_premiere" ? (premiere_cutoff as string) : null,
    computed_at,
    castaways: parsed,
  };
};

export type CastawayAdpState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "too_few";
      summary: CastawayAdpSummary;
      /** Pre-premiere only: the premiere has aired, so no more drafts can qualify. */
      closed: boolean;
    }
  | { kind: "ready"; summary: CastawayAdpSummary };

export const castawayAdpState = (
  loaded: boolean,
  summary: CastawayAdpSummary | null,
  now: Date = new Date(),
): CastawayAdpState => {
  if (!loaded) return { kind: "loading" };
  if (!summary) return { kind: "unavailable" };
  if (Object.keys(summary.castaways).length === 0) {
    return {
      kind: "too_few",
      summary,
      closed:
        summary.premiere_cutoff !== null &&
        now.getTime() >= Date.parse(summary.premiere_cutoff),
    };
  }
  return { kind: "ready", summary };
};

/**
 * What an all-drafts opt-in is bound to: one season for one account. The
 * draft page keeps the key the viewer confirmed and shows all-drafts numbers
 * only while it still matches, so a different season or a different
 * signed-in account starts back at the pre-premiere default.
 */
export const allDraftsOptInKey = (
  seasonId: Season["id"] | undefined,
  uid: string | undefined,
): string | null => (seasonId && uid ? `${seasonId}:${uid}` : null);

/**
 * Whether to offer the all-drafts opt-in beside the pre-premiere state.
 * Before the premiere every draft is a pre-premiere draft, so it would add
 * nothing; once the premiere has aired, or when no pre-premiere summary
 * exists to say when it airs, the viewer may choose it.
 */
export const allDraftsOffered = (
  preState: CastawayAdpState,
  now: Date,
): boolean => {
  if (preState.kind === "loading") return false;
  if (preState.kind === "unavailable") return true;
  const cutoff = preState.summary.premiere_cutoff;
  return cutoff === null || now.getTime() >= Date.parse(cutoff);
};

/**
 * Order castaways earliest ADP first. Castaways without a published average
 * come last, then ties fall back to the caller's existing order (the cast
 * grid's alphabetical order), so the sort is stable.
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

/**
 * Transform survivoR data into the app's existing scraper types
 * (ScrapeResult, ScrapeResultsOutput) so the existing codegen pipeline
 * can generate season files from survivoR data without modification.
 */

import type { SurvivorSeasonData } from "./survivor-client.js";
import type {
  SurvivorAdvantageDetail,
  SurvivorAdvantageMovement,
  SurvivorCastaway,
  SurvivorChallengeResult,
  SurvivorEpisode,
  SurvivorJourney,
  SurvivorTribeMapping,
  SurvivorVoteHistory,
} from "./survivor-types.js";
import type {
  ScrapedChallenge,
  ScrapedChallengeVariant,
  ScrapedElimination,
  ScrapedEliminationVariant,
  ScrapedEpisode,
  ScrapedGameEvent,
  ScrapedPlayer,
  ScrapedVoteRow,
  ScrapeResult,
  ScrapeResultsOutput,
} from "./types.js";

/** Group an array into a Map keyed by a derived value. */
function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

/**
 * Build a lookup map from castaway short name / full_name → castaway_id.
 * Used to resolve short names in tribe_mapping back to castaway_id.
 */
function buildCastawayIdMap(
  castaways: SurvivorCastaway[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of castaways) {
    map.set(c.castaway, c.castaway_id);
    map.set(c.full_name, c.castaway_id);
    map.set(c.castaway_id, c.castaway_id);
  }
  return map;
}

/** Resolve a short name or full_name to castaway_id. */
function resolveCastawayId(
  nameOrId: string,
  idMap: Map<string, string>,
): string {
  const resolved = idMap.get(nameOrId);
  if (!resolved) {
    throw new Error(
      `Could not resolve "${nameOrId}" to a castaway_id. Check survivoR data for name mismatches.`,
    );
  }
  return resolved;
}

/**
 * Transform survivoR season data into the app's ScrapeResult (players).
 */
export function transformPlayers(
  data: SurvivorSeasonData,
  seasonNum: number,
): ScrapeResult {
  // Deduplicate castaways by castaway_id (returning players appear once per season)
  const seen = new Set<string>();
  const uniqueCastaways: SurvivorCastaway[] = [];
  for (const c of data.castaways) {
    if (!seen.has(c.castaway_id)) {
      seen.add(c.castaway_id);
      uniqueCastaways.push(c);
    }
  }

  const players: ScrapedPlayer[] = uniqueCastaways.map((c) => {
    const hometown =
      c.city && c.state
        ? `${c.city}, ${c.state}`
        : c.city || c.state || undefined;

    return {
      wikiPageTitle: c.full_name,
      localName: c.full_name,
      castawayId: c.castaway_id,
      castawayShortName: c.castaway,
      matchStatus: "exact" as const,
      age: c.age ?? undefined,
      hometown,
      nickname:
        c.castaway !== c.full_name.split(" ")[0] ? c.castaway : undefined,
    };
  });

  return {
    seasonNum,
    scrapedAt: new Date().toISOString(),
    players,
    unmatched: [],
  };
}

/**
 * Transform survivoR season data into the app's ScrapeResultsOutput (gameplay).
 */
export function transformResults(
  data: SurvivorSeasonData,
  seasonNum: number,
): ScrapeResultsOutput {
  const warnings: string[] = [];
  const idMap = buildCastawayIdMap(data.castaways);

  const hasWinner = data.castaways.some((c) => c.winner);
  const episodes = transformEpisodes(
    data.episodes,
    data.tribeMapping,
    hasWinner,
  );
  const challenges = transformChallenges(
    data.challengeResults,
    data.voteHistory,
  );
  const eliminations = transformEliminations(data.castaways);
  const events = transformEvents(
    data.advantageMovement,
    data.advantageDetails,
    data.voteHistory,
    data.journeys,
    data.castaways,
    data.tribeMapping,
    idMap,
    warnings,
  );

  const castawayIdSet = new Set(data.castaways.map((c) => c.castaway_id));
  const voteHistory = transformVoteHistory(data.voteHistory, castawayIdSet);

  // Warn about data gaps
  if (data.episodes.length === 0) {
    warnings.push(`No episodes found for Season ${seasonNum} in survivoR`);
  }
  if (data.challengeResults.length === 0) {
    warnings.push(
      `No challenge results found for Season ${seasonNum} in survivoR`,
    );
  }

  return {
    seasonNum,
    scrapedAt: new Date().toISOString(),
    episodes,
    challenges,
    eliminations,
    events,
    voteHistory,
    warnings,
  };
}

// --- Episode transformation ---

function transformEpisodes(
  episodes: SurvivorEpisode[],
  tribeMapping: SurvivorTribeMapping[],
  hasWinner: boolean,
): ScrapedEpisode[] {
  // Detect merge episode: "Mergatory" (S46+) marks the actual merge episode;
  // for older seasons, the first "Merged" status IS the merge episode.
  const mergeEp = detectMergeEpisode(tribeMapping);
  const mergeEpisodes = new Set<number>();
  const postMergeEpisodes = new Set<number>();
  if (mergeEp !== null) {
    mergeEpisodes.add(mergeEp);
    const episodeNums = [
      ...new Set(tribeMapping.map((t) => Math.round(t.episode))),
    ].sort((a, b) => a - b);
    for (const ep of episodeNums) {
      if (ep >= mergeEp) postMergeEpisodes.add(ep);
    }
  }

  const maxEpNum = Math.max(...episodes.map((e) => Math.round(e.episode)));

  return episodes.map((ep) => {
    const epNum = Math.round(ep.episode);

    return {
      order: epNum,
      title: ep.episode_title || `Episode ${epNum}`,
      airDate: new Date(ep.episode_date).toISOString().split("T")[0],
      isFinale: hasWinner && epNum === maxEpNum,
      postMerge: postMergeEpisodes.has(epNum),
      mergeOccurs: mergeEpisodes.has(epNum),
    };
  });
}

// --- Challenge transformation ---

/** Determine whether a reward challenge is individual or team/tribal. */
function getRewardVariant(
  first: SurvivorChallengeResult,
  winners: SurvivorChallengeResult[],
): "reward" | "team_reward" {
  const ot = first.outcome_type;
  if (ot === "Individual") return "reward";
  if (ot === "Tribal" || ot === "Team") return "team_reward";
  // Hybrid types like "Team / Individual" — classify by majority of winner flags
  if (ot?.includes("/")) {
    const teamCount = winners.filter((w) => w.won_team_reward === 1).length;
    const indCount = winners.filter(
      (w) => w.won_individual_reward === 1,
    ).length;
    return teamCount >= indCount ? "team_reward" : "reward";
  }
  // Fallback for null/empty outcome_type on early seasons
  if (winners.some((w) => w.won_individual_reward === 1)) return "reward";
  return "team_reward";
}

/** Determine whether an immunity challenge is individual or team/tribal. */
function getImmunityVariant(
  first: SurvivorChallengeResult,
  winners: SurvivorChallengeResult[],
): "immunity" | "team_immunity" {
  const ot = first.outcome_type;
  if (ot === "Individual") return "immunity";
  if (ot === "Tribal" || ot === "Team") return "team_immunity";
  // Hybrid types like "Team / Individual" — classify by majority of winner flags
  if (ot?.includes("/")) {
    const teamCount = winners.filter(
      (w) => w.won_team_immunity === 1 || w.won_tribal_immunity === 1,
    ).length;
    const indCount = winners.filter(
      (w) => w.won_individual_immunity === 1,
    ).length;
    return teamCount >= indCount ? "team_immunity" : "immunity";
  }
  // Fallback for null/empty outcome_type on early seasons
  if (winners.some((w) => w.won_individual_immunity === 1)) return "immunity";
  return "team_immunity";
}

function transformChallenges(
  results: SurvivorChallengeResult[],
  voteHistory: SurvivorVoteHistory[],
): ScrapedChallenge[] {
  const byChallenge = groupBy(results, (r) => Math.round(r.challenge_id));

  const challenges: ScrapedChallenge[] = [];
  let order = 0;

  // Sort challenges by episode then challenge_id
  const sortedIds = [...byChallenge.keys()].sort((a, b) => {
    const aEp = Math.round(byChallenge.get(a)![0].episode);
    const bEp = Math.round(byChallenge.get(b)![0].episode);
    if (aEp !== bEp) return aEp - bEp;
    return a - b;
  });

  for (const chalId of sortedIds) {
    const entries = byChallenge.get(chalId)!;
    const first = entries[0];
    const epNum = Math.round(first.episode);
    const type = first.challenge_type.toLowerCase();
    const isCombined = type.includes("immunity") && type.includes("reward");

    if (type === "duel") {
      const winners = entries.filter((e) => e.won_duel === 1);
      order += emitChallengeEntries(
        winners,
        first,
        epNum,
        "duel",
        challenges,
        order,
      );
    } else if (isCombined) {
      // Split combined challenges into separate immunity + reward entries
      const immunityWinners = entries.filter(
        (e) =>
          e.won_tribal_immunity === 1 ||
          e.won_individual_immunity === 1 ||
          e.won_team_immunity === 1,
      );
      const rewardWinners = entries.filter(
        (e) =>
          e.won_tribal_reward === 1 ||
          e.won_individual_reward === 1 ||
          e.won_team_reward === 1,
      );

      order += emitHybridChallengeEntries(
        immunityWinners,
        first,
        epNum,
        "immunity",
        challenges,
        order,
      );
      order += emitHybridChallengeEntries(
        rewardWinners,
        first,
        epNum,
        "reward",
        challenges,
        order,
      );
    } else {
      const winners = entries.filter((e) => e.won === 1);
      order += emitHybridChallengeEntries(
        winners,
        first,
        epNum,
        type.includes("immunity") ? "immunity" : "reward",
        challenges,
        order,
      );
    }
  }

  order = applyBeastChallengeImmunity(challenges, voteHistory, order);

  return challenges;
}

/**
 * Grant individual immunity to castaways who won it via the Mr. Beast
 * coin-flip twist rather than by winning the challenge itself. Immunity is
 * scored off challenges.winning_castaways (it is a ChallengeWinAction, not a
 * GameEventAction), so it has to land here rather than in transformEvents.
 *
 * Prefers adding the castaway to the episode's existing individual immunity
 * challenge; if that episode has none, emits a standalone entry.
 */
function applyBeastChallengeImmunity(
  challenges: ScrapedChallenge[],
  voteHistory: SurvivorVoteHistory[],
  startOrder: number,
): number {
  let order = startOrder;

  for (const [castawayId, epNum] of beastChallengeEpisodes(voteHistory)) {
    const existing = challenges.find(
      (c) => c.episodeNum === epNum && c.variant === "immunity",
    );

    if (existing) {
      if (!existing.winnerCastawayIds.includes(castawayId)) {
        existing.winnerCastawayIds.push(castawayId);
      }
      continue;
    }

    challenges.push({
      episodeNum: epNum,
      variant: "immunity",
      winnerCastawayIds: [castawayId],
      winnerTribe: null,
      order: order++,
    });
  }

  return order;
}

/**
 * For hybrid "Team / Individual" outcome types, split winners so each player
 * gets the higher-scoring variant. Players with an individual flag get
 * individual credit; the rest get team credit. Non-hybrid challenges pass
 * through to a single emit.
 */
function emitHybridChallengeEntries(
  winners: SurvivorChallengeResult[],
  first: SurvivorChallengeResult,
  epNum: number,
  kind: "immunity" | "reward",
  challenges: ScrapedChallenge[],
  startOrder: number,
): number {
  const ot = first.outcome_type;
  const isHybrid = ot?.includes("/");

  if (isHybrid) {
    const indField =
      kind === "immunity" ? "won_individual_immunity" : "won_individual_reward";
    const indWinners = winners.filter((w) => w[indField] === 1);
    const teamWinners = winners.filter((w) => w[indField] !== 1);

    let count = 0;
    if (teamWinners.length > 0) {
      const variant = kind === "immunity" ? "team_immunity" : "team_reward";
      count += emitChallengeEntries(
        teamWinners,
        first,
        epNum,
        variant,
        challenges,
        startOrder + count,
      );
    }
    if (indWinners.length > 0) {
      count += emitChallengeEntries(
        indWinners,
        first,
        epNum,
        kind,
        challenges,
        startOrder + count,
      );
    }
    return count;
  }

  // Non-hybrid: single variant for all winners
  const variant =
    kind === "immunity"
      ? getImmunityVariant(first, winners)
      : getRewardVariant(first, winners);
  return emitChallengeEntries(
    winners,
    first,
    epNum,
    variant,
    challenges,
    startOrder,
  );
}

/** Emit challenge entries, splitting tribal challenges by tribe. Returns the order increment. */
function emitChallengeEntries(
  winners: SurvivorChallengeResult[],
  first: SurvivorChallengeResult,
  epNum: number,
  variant: ScrapedChallengeVariant,
  challenges: ScrapedChallenge[],
  startOrder: number,
): number {
  if (first.outcome_type?.includes("Tribal") && winners.length > 0) {
    const winnersByTribe = groupBy(winners, (w) => w.tribe);

    let idx = 0;
    for (const [tribe, tribeWinners] of winnersByTribe) {
      challenges.push({
        episodeNum: epNum,
        variant,
        winnerCastawayIds: tribeWinners.map((w) => w.castaway_id),
        winnerTribe: tribe,
        order: startOrder + idx,
      });
      idx++;
    }
    return winnersByTribe.size;
  }

  challenges.push({
    episodeNum: epNum,
    variant,
    winnerCastawayIds: winners.map((w) => w.castaway_id),
    winnerTribe: null,
    order: startOrder,
  });
  return 1;
}

// --- Elimination transformation ---

function transformEliminations(
  castaways: SurvivorCastaway[],
): ScrapedElimination[] {
  // Filter to eliminated players — exclude the winner (they were never eliminated)
  // Sort by order (elimination order)
  const eliminated = castaways
    .filter((c) => c.result != null && c.result !== "" && !c.winner)
    .sort((a, b) => a.order - b.order);

  return eliminated.map((c, idx) => {
    const variant = mapResultToVariant(c.result);
    const epNum = Math.round(c.episode);

    return {
      episodeNum: epNum,
      castawayId: c.castaway_id,
      voteString: "",
      variant,
      finishText: c.result,
      order: idx + 1,
    };
  });
}

function mapResultToVariant(result: string): ScrapedEliminationVariant {
  const lower = result.toLowerCase();
  if (lower.includes("sole survivor") || lower.includes("winner"))
    return "final_tribal_council";
  if (lower.includes("runner") || lower.includes("finalist"))
    return "final_tribal_council";
  if (lower.includes("medically evacuated") || lower.includes("medical"))
    return "medical";
  if (lower.includes("quit") || lower.includes("withdrew")) return "quitter";
  if (lower.includes("ejected")) return "ejected";
  if (lower.includes("switched")) return "switched";
  // Covers "voted out", "Xth voted out", "eliminated", and fire-making
  if (
    lower.includes("voted out") ||
    lower.includes("eliminated") ||
    lower.includes("fire")
  )
    return "tribal";
  throw new Error(
    `Unknown elimination result "${result}". Add handling to mapResultToVariant.`,
  );
}

// --- Event transformation ---

/** Map advantage_details.advantage_type → specific find action. */
const ADVANTAGE_TYPE_TO_FIND: Record<string, string> = {
  "Hidden Immunity Idol": "find_idol",
  "Hidden Immunity Idol Half": "find_idol",
  "Preventative Hidden Immunity Idol": "find_idol",
  "Super Idol": "find_idol",
  "Extra Vote": "find_extra_vote",
  "Steal a Vote": "find_steal_a_vote",
  "Block a Vote": "find_block_a_vote",
  "Vote Blocker": "find_block_a_vote",
  "Bank your Vote": "find_bank_your_vote",
  "Idol Nullifier": "find_idol_nullifier",
  "Knowledge is Power": "find_knowledge_is_power",
  "Safety without Power": "find_safety_without_power",
  "Control the Vote": "find_control_the_vote",
  Amulet: "find_amulet",
  "Challenge Advantage": "find_challenge_advantage",
  "Advantage Menu": "find_other_advantage",
  "Choose your Champion": "find_other_advantage",
  "Goodwill Advantage": "find_other_advantage",
  "Inheritance Advantage": "find_other_advantage",
  "Reward Stealer": "find_other_advantage",
};

/** Map advantage_details.advantage_type → specific use action. */
const ADVANTAGE_TYPE_TO_USE: Record<string, string> = {
  "Hidden Immunity Idol": "use_idol",
  "Hidden Immunity Idol Half": "use_idol",
  "Preventative Hidden Immunity Idol": "use_idol",
  "Super Idol": "use_idol",
  "Extra Vote": "use_extra_vote",
  "Steal a Vote": "use_steal_a_vote",
  "Block a Vote": "use_block_a_vote",
  "Vote Blocker": "use_block_a_vote",
  "Bank your Vote": "use_bank_your_vote",
  "Idol Nullifier": "use_idol_nullifier",
  "Knowledge is Power": "use_knowledge_is_power",
  "Safety without Power": "use_safety_without_power",
  "Control the Vote": "use_control_the_vote",
  Amulet: "use_amulet",
  "Challenge Advantage": "use_challenge_advantage",
  "Advantage Menu": "use_other_advantage",
  "Choose your Champion": "use_other_advantage",
  "Goodwill Advantage": "use_other_advantage",
  "Inheritance Advantage": "use_other_advantage",
  "Reward Stealer": "use_other_advantage",
};

/** Non-scoring vote events — explicitly skipped. */
const IGNORED_VOTE_EVENTS = new Set([
  "Beware advantage",
  "Abstain to gain",
  "Countback",
  "Deadlock",
  "Do or die",
  "Exiled",
  "Final 3 tribal",
  "First out in challenge",
  "Ghost island game",
  "Island of the idols game",
  "Journey challenge",
  "Kidnapped",
  "Lost vote at survivor auction",
  "Lost vote on journey",
  "Nature quiz",
  "Player quit",
  "Quit",
  "Rock draw",
  "Unanimous decision",
  "Won immunity challenge",
  "Sacrificed vote to extend idol",
  "Summit",
  "Vote blocked",
  // Trailing clauses of compound vote_event values. survivoR joins several
  // events into one field with "; " and lowercases everything after the
  // first clause, so these are matched case-insensitively.
  "goodwill advantage",
]);

/**
 * Mr. Beast "super beware advantage" coin-flip twist (S50 ep10). Winning
 * grants a hidden immunity idol plus individual immunity at that tribal.
 * survivoR records it as a trailing clause on the castaway's vote_history
 * row, and separately logs an advantage_movement "Found" for the same idol
 * an episode later, which transformEvents suppresses.
 */
const BEAST_CHALLENGE_VOTE_EVENT = "won beast challenge";

/** Map castaway_id → episode for every beast-challenge win in the season. */
function beastChallengeEpisodes(
  voteHistory: SurvivorVoteHistory[],
): Map<string, number> {
  const byCastaway = new Map<string, number>();
  for (const v of voteHistory) {
    const won = splitVoteField(v.vote_event).some((clause) =>
      matchesVoteEvent(clause, BEAST_CHALLENGE_VOTE_EVENT),
    );
    if (won) byCastaway.set(v.castaway_id, Math.round(v.episode));
  }
  return byCastaway;
}

/**
 * survivoR packs multiple events into `vote_event` / `vote_event_outcome`
 * using "; " as the separator (e.g. "Steal a vote; won beast challenge").
 * Split into trimmed, non-empty clauses.
 */
function splitVoteField(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Compare two vote-event clauses. Casing is inconsistent in the source data —
 * clauses after the first are lowercased — so match case-insensitively.
 */
function matchesVoteEvent(clause: string, expected: string): boolean {
  return clause.toLowerCase() === expected.toLowerCase();
}

/** Case-insensitive membership test against a vote-event set. */
function hasVoteEvent(set: Set<string>, clause: string): boolean {
  const needle = clause.toLowerCase();
  for (const entry of set) {
    if (entry.toLowerCase() === needle) return true;
  }
  return false;
}

/**
 * Vote events that correspond to advantage plays — these are already scored
 * via the advantage_movement "Played" path and must NOT be scored again here.
 * Kept as a set for the vote_history loop to skip silently.
 */
const ADVANTAGE_PLAY_VOTE_EVENTS = new Set([
  "Extra vote",
  "Steal a vote",
  "Block a vote",
  "Played block a vote",
  "Vote blocker",
  "Bank your vote",
  "Played bank your vote",
  "Played banked vote",
  "Safety without power",
  "Control the vote",
]);

/** Journey rewards that don't grant a new advantage — explicitly skipped. */
const IGNORED_JOURNEY_REWARDS = new Set([
  "Regained vote",
  "Returned to camp",
  "Sanctuary feast",
  "Escaped Exile Island",
]);

/** Map journeys.reward → specific win action. */
const JOURNEY_REWARD_TO_WIN: Record<string, string> = {
  "Extra vote": "win_extra_vote",
  "Extra Vote": "win_extra_vote",
  "Block a Vote": "win_block_a_vote",
  "Block a vote": "win_block_a_vote",
  "Steal a Vote": "win_steal_a_vote",
  "Bank your vote": "win_other_advantage",
  "Safety Without Power": "win_other_advantage",
  Idol: "win_idol",
  "Hidden Immunity Idol": "win_idol",
  "Knowledge is Power": "win_other_advantage",
  Amulet: "win_other_advantage",
  "Challenge advantage": "win_other_advantage",
  "Inheritance advantage": "win_other_advantage",
};

/** Non-scoring advantage lifecycle events — explicitly skipped. */
const IGNORED_ADVANTAGE_EVENTS = new Set([
  "Absorbed",
  "Activated",
  "Banked",
  "Became hidden immunity idol",
  "Became steal a vote",
  "Destroyed",
  "Discarded",
  "Expired",
  "Gave", // Recipient's "Received" event handles the scoring
  "Holding", // Status snapshot at a vote, not a lifecycle change
  "Left game with advantage",
  "Medically evacuated with advantage",
  "Quit with advantage",
  "Transferred", // Recipient's "Received" event handles the scoring
]);

/** Idol advantage types (for beware lifecycle detection). */
const IDOL_TYPES = new Set([
  "Hidden Immunity Idol",
  "Hidden Immunity Idol Half",
  "Preventative Hidden Immunity Idol",
  "Super Idol",
]);

// --- Vote-history transformation ---

/** Vote events that are NOT standard Tribal Council votes — exclude from raw vote export. */
const NON_TRIBAL_VOTE_EVENTS = new Set([
  "Shot in the dark",
  "Fire challenge",
  "Fire challenge (f4)",
]);

/**
 * Transform survivoR vote_history rows into normalized Tribal Council vote rows.
 * Filters out non-Tribal mechanics so downstream code only sees formal Tribal votes.
 * Deduplicates by composite key (sogId + voterCastawayId + voteOrder + targetCastawayId).
 */
function transformVoteHistory(
  voteHistory: SurvivorVoteHistory[],
  castawayIds: Set<string>,
): ScrapedVoteRow[] {
  const rows = voteHistory
    .filter((v) => {
      // Exclude non-Tribal vote mechanics
      if (v.vote_event && NON_TRIBAL_VOTE_EVENTS.has(v.vote_event))
        return false;
      // Only include rows targeting valid castaways
      if (!v.vote_id || !v.vote_id.startsWith("US")) return false;
      // Only include rows from known voters
      if (!castawayIds.has(v.castaway_id)) return false;
      return true;
    })
    .map((v) => ({
      episodeNum: Math.round(v.episode),
      tribe: v.tribe || "",
      voterCastawayId: v.castaway_id,
      targetCastawayId: v.vote_id,
      votedOutCastawayId: v.voted_out_id,
      nullified: v.nullified,
      tie: v.tie,
      sogId: Math.round(v.sog_id),
      voteOrder: Math.round(v.vote_order),
    }))
    .sort(
      (a, b) =>
        a.episodeNum - b.episodeNum ||
        a.sogId - b.sogId ||
        a.voteOrder - b.voteOrder,
    );

  // Deduplicate by composite key
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.sogId}_${r.voterCastawayId}_${r.voteOrder}_${r.targetCastawayId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function transformEvents(
  advantageMovement: SurvivorAdvantageMovement[],
  advantageDetails: SurvivorAdvantageDetail[],
  voteHistory: SurvivorVoteHistory[],
  journeys: SurvivorJourney[],
  castaways: SurvivorCastaway[],
  tribeMapping: SurvivorTribeMapping[],
  idMap: Map<string, string>,
  warnings: string[],
): ScrapedGameEvent[] {
  const events: ScrapedGameEvent[] = [];

  // Build advantage_id → detail lookup for type-aware event mapping
  const detailById = new Map<number, SurvivorAdvantageDetail>();
  for (const d of advantageDetails) {
    detailById.set(d.advantage_id, d);
  }

  // Track beware advantage_ids that have been "Found (beware)" to detect fulfill
  const bewareFoundIds = new Set<number>();

  // Mr. Beast "super beware advantage" twist (S50 ep10): a coin flip that
  // grants individual immunity at this tribal AND a hidden immunity idol.
  // survivoR encodes the win as a clause on the castaway's vote_history row
  // in the actual episode, but its advantage_movement records a separate
  // "Found" event for the same idol one episode later. We score win_idol from
  // the vote_event and suppress the duplicate "Found" here.
  const twistIdolEpByCastaway = beastChallengeEpisodes(voteHistory);

  // Advantage events — type-aware mapping using advantage_details
  for (const adv of advantageMovement) {
    const epNum = Math.round(adv.episode);
    const event = adv.event;

    // Skip multi-player advantage records (e.g., team idols with comma-separated IDs)
    if (adv.castaway_id.includes(",")) {
      warnings.push(
        `Episode ${epNum}: skipping multi-player advantage (${event}) for "${adv.castaway_id}" — individual player events should exist separately`,
      );
      continue;
    }

    const castawayId = adv.castaway_id;
    const detail = detailById.get(adv.advantage_id);
    if (!detail) {
      throw new Error(
        `No advantage_details entry for advantage_id ${adv.advantage_id} (${event} by ${castawayId} in episode ${epNum}). Check survivoR data.`,
      );
    }
    const advType = detail.advantage_type;

    if (event === "Found (beware)") {
      bewareFoundIds.add(adv.advantage_id);
      events.push({
        episodeNum: epNum,
        castawayId,
        action: "find_beware_advantage",
        multiplier: null,
      });
      events.push({
        episodeNum: epNum,
        castawayId,
        action: "accept_beware_advantage",
        multiplier: null,
      });
    } else if (event.startsWith("Found")) {
      // Skip the duplicate "Found" survivoR records for an idol acquired via
      // the Mr. Beast coin-flip twist — already scored from vote_history below.
      const twistEp = twistIdolEpByCastaway.get(castawayId);
      if (
        twistEp !== undefined &&
        IDOL_TYPES.has(advType) &&
        epNum - twistEp >= 0 &&
        epNum - twistEp <= 1
      ) {
        continue;
      }

      if (bewareFoundIds.has(adv.advantage_id)) {
        events.push({
          episodeNum: epNum,
          castawayId,
          action: "fulfill_beware_advantage",
          multiplier: null,
        });
      }
      const findAction = ADVANTAGE_TYPE_TO_FIND[advType];
      if (!findAction) {
        throw new Error(
          `Unknown advantage type "${advType}" found by ${castawayId} in episode ${epNum}. Add it to ADVANTAGE_TYPE_TO_FIND.`,
        );
      }
      events.push({
        episodeNum: epNum,
        castawayId,
        action: findAction,
        multiplier: null,
      });
    } else if (event === "Played") {
      const useAction = ADVANTAGE_TYPE_TO_USE[advType];
      if (!useAction) {
        throw new Error(
          `Unknown advantage type "${advType}" played by ${castawayId} in episode ${epNum}. Add it to ADVANTAGE_TYPE_TO_USE.`,
        );
      }
      events.push({
        episodeNum: epNum,
        castawayId,
        action: useAction,
        multiplier: null,
      });
    } else if (event === "Received" || event === "Recieved") {
      const winAction = IDOL_TYPES.has(advType)
        ? "win_idol"
        : "win_other_advantage";
      events.push({
        episodeNum: epNum,
        castawayId,
        action: winAction,
        multiplier: null,
      });
    } else if (event === "Voted out with advantage") {
      events.push({
        episodeNum: epNum,
        castawayId,
        action: IDOL_TYPES.has(advType)
          ? "voted_out_with_idol"
          : "voted_out_with_advantage",
        multiplier: null,
      });
    } else if (IGNORED_ADVANTAGE_EVENTS.has(event)) {
      // Non-scoring lifecycle events — skip silently
    } else {
      throw new Error(
        `Unknown advantage event "${event}" for ${advType} by ${castawayId} in episode ${epNum}. Add handling for this event type.`,
      );
    }
  }

  // Derive votes_negated_by_idol from nullified votes + idol plays.
  //
  // Strategy: prefer the structured `votes_nullified` / `played_for_id` fields
  // on the advantage_movement record (present on newer survivoR data). Fall back
  // to matching nullified vote_history entries against the idol target.

  // Group nullified votes by (episode, target castaway_id)
  const nullifiedByEp = new Map<number, Map<string, number>>();
  for (const v of voteHistory) {
    if (!v.nullified) continue;
    const epNum = Math.round(v.episode);
    if (!nullifiedByEp.has(epNum)) nullifiedByEp.set(epNum, new Map());
    const targets = nullifiedByEp.get(epNum)!;
    targets.set(v.vote_id, (targets.get(v.vote_id) ?? 0) + 1);
  }

  // Collect idol plays from advantage_movement
  const idolPlays = advantageMovement.filter(
    (a) =>
      a.event === "Played" &&
      IDOL_TYPES.has(detailById.get(a.advantage_id)?.advantage_type ?? ""),
  );

  for (const adv of idolPlays) {
    const epNum = Math.round(adv.episode);

    // If survivoR provides votes_nullified directly, use it
    if (adv.votes_nullified != null && adv.votes_nullified > 0) {
      events.push({
        episodeNum: epNum,
        castawayId: adv.castaway_id,
        action: "votes_negated_by_idol",
        multiplier: adv.votes_nullified,
      });
      // Consume the matching nullified entries so they aren't double-matched
      const protectedId = adv.played_for_id ?? adv.castaway_id;
      const targets = nullifiedByEp.get(epNum);
      if (targets) targets.delete(protectedId);
      continue;
    }

    // Fallback: match against nullified vote_history entries
    const targets = nullifiedByEp.get(epNum);
    if (!targets || targets.size === 0) continue;

    // Determine who the idol was played for — played_for_id when available,
    // otherwise assume self-play
    const protectedId = adv.played_for_id ?? adv.castaway_id;

    let matchedTarget: string | undefined;
    if (targets.has(protectedId)) {
      matchedTarget = protectedId;
    } else if (targets.size === 1) {
      // Only one unmatched target left — take it
      matchedTarget = targets.keys().next().value;
    }

    if (matchedTarget) {
      const negatedCount = targets.get(matchedTarget)!;
      targets.delete(matchedTarget);

      events.push({
        episodeNum: epNum,
        castawayId: adv.castaway_id,
        action: "votes_negated_by_idol",
        multiplier: negatedCount,
      });
    } else {
      warnings.push(
        `Episode ${epNum}: could not match idol play by ${adv.castaway_id} to nullified votes (${targets.size} unmatched targets)`,
      );
    }
  }

  // Journey events (S41+) — risk/reward scoring
  for (const j of journeys) {
    const epNum = Math.round(j.episode);
    const castawayId = j.castaway_id;

    // Base participation event
    events.push({
      episodeNum: epNum,
      castawayId,
      action: "go_on_journey",
      multiplier: null,
    });

    // Parse reward parts (handles compound rewards like "Amulet; Lost vote")
    const rewardParts = j.reward ? j.reward.split("; ") : [];
    const winParts = rewardParts.filter(
      (p) =>
        !p.toLowerCase().includes("lost") && !IGNORED_JOURNEY_REWARDS.has(p),
    );
    const winActions = winParts
      .map((p) => {
        const action = JOURNEY_REWARD_TO_WIN[p];
        if (!action && !IGNORED_JOURNEY_REWARDS.has(p)) {
          throw new Error(
            `Unknown journey reward part "${p}" (from "${j.reward}") for ${castawayId} in episode ${epNum}. Add it to JOURNEY_REWARD_TO_WIN or IGNORED_JOURNEY_REWARDS.`,
          );
        }
        return action;
      })
      .filter(Boolean);

    // Determine if the player risked their vote
    // S44+: explicit chose_to_play field; S41-S43: infer from outcome
    // For S41-S43: risked+lost nets to 0 points (+1 risk, -1 lost vote)
    // Filter out ignored rewards (e.g., "Returned to camp") before inferring risk
    const hasNonLossReward = rewardParts.some(
      (p) =>
        !p.toLowerCase().includes("lost") && !IGNORED_JOURNEY_REWARDS.has(p),
    );
    const risked =
      j.chose_to_play !== undefined
        ? j.chose_to_play === true
        : j.lost_vote || hasNonLossReward;

    if (risked) {
      events.push({
        episodeNum: epNum,
        castawayId,
        action: "journey_risked_vote",
        multiplier: null,
      });
    }

    if (winActions.length > 0) {
      events.push({
        episodeNum: epNum,
        castawayId,
        action: "journey_won_game",
        multiplier: null,
      });

      // Emit the specific win action(s) for the reward type(s)
      for (const winAction of winActions) {
        events.push({
          episodeNum: epNum,
          castawayId,
          action: winAction,
          multiplier: null,
        });
      }
    }

    if (j.lost_vote) {
      events.push({
        episodeNum: epNum,
        castawayId,
        action: "journey_lost_vote",
        multiplier: null,
      });
    }
  }

  // Vote history events (S41+) — SITD and advantage plays from vote_event
  for (const v of voteHistory) {
    if (!v.vote_event) continue;
    const epNum = Math.round(v.episode);
    const castawayId = v.castaway_id;

    // A single row can carry several semicolon-joined events, with
    // vote_event_outcome listing the matching outcomes in the same order
    // (e.g. "Steal a vote; won beast challenge" / "Lost vote; gained
    // individual immunity"). Handle each pair independently.
    const voteEvents = splitVoteField(v.vote_event);
    const outcomes = splitVoteField(v.vote_event_outcome);

    for (const [i, voteEvent] of voteEvents.entries()) {
      // Only trust positional pairing when the counts line up; otherwise fall
      // back to the single outcome so we never read a neighbour's result.
      const outcome =
        voteEvents.length === outcomes.length
          ? outcomes[i]
          : (v.vote_event_outcome ?? "");

      if (matchesVoteEvent(voteEvent, "Shot in the dark")) {
        const success = matchesVoteEvent(outcome, "Safe");
        events.push({
          episodeNum: epNum,
          castawayId,
          action: success
            ? "use_shot_in_the_dark_successfully"
            : "use_shot_in_the_dark_unsuccessfully",
          multiplier: null,
        });
      } else if (
        matchesVoteEvent(voteEvent, "Fire challenge") ||
        matchesVoteEvent(voteEvent, "Fire challenge (f4)")
      ) {
        if (matchesVoteEvent(outcome, "Won")) {
          events.push({
            episodeNum: epNum,
            castawayId,
            action: "win_fire_making",
            multiplier: null,
          });
        }
        // "Lost", "Saved", "Immune", "Vote not required" → no event
      } else if (matchesVoteEvent(voteEvent, BEAST_CHALLENGE_VOTE_EVENT)) {
        // The idol is a game event. The individual immunity is NOT — immunity
        // is scored off challenges.winning_castaways, so it is applied to the
        // episode's individual immunity challenge in transformChallenges.
        events.push({
          episodeNum: epNum,
          castawayId,
          action: "win_idol",
          multiplier: null,
        });
      } else if (hasVoteEvent(ADVANTAGE_PLAY_VOTE_EVENTS, voteEvent)) {
        // Already scored via advantage_movement "Played" events — skip to avoid double-counting
      } else if (!hasVoteEvent(IGNORED_VOTE_EVENTS, voteEvent)) {
        throw new Error(
          `Unknown vote_event "${voteEvent}" (from "${v.vote_event}") for ${castawayId} in episode ${epNum}. Add it to ADVANTAGE_PLAY_VOTE_EVENTS or IGNORED_VOTE_EVENTS.`,
        );
      }
    }
  }

  // Merge event — detect from tribe_mapping
  const mergeEp = detectMergeEpisode(tribeMapping);
  if (mergeEp !== null) {
    const mergedIds = tribeMapping
      .filter(
        (t) =>
          Math.round(t.episode) === mergeEp &&
          (t.tribe_status === "Merged" || t.tribe_status === "Mergatory"),
      )
      .map((t) => resolveCastawayId(t.castaway, idMap));

    const uniqueMerged = [...new Set(mergedIds)];
    for (const castawayId of uniqueMerged) {
      events.push({
        episodeNum: mergeEp,
        castawayId,
        action: "make_merge",
        multiplier: null,
      });
    }
  }

  // Winner event
  const winner = castaways.find((c) => c.winner);
  if (winner) {
    const lastEp = Math.max(...castaways.map((c) => Math.round(c.episode)));
    events.push({
      episodeNum: lastEp,
      castawayId: winner.castaway_id,
      action: "win_survivor",
      multiplier: null,
    });

    // FTC participants
    const finalists = castaways.filter((c) => c.finalist || c.winner);
    for (const f of finalists) {
      events.push({
        episodeNum: lastEp,
        castawayId: f.castaway_id,
        action: "make_final_tribal_council",
        multiplier: null,
      });
    }
  }

  return events;
}

function detectMergeEpisode(
  tribeMapping: SurvivorTribeMapping[],
): number | null {
  // "Mergatory" (S46+) marks the actual merge episode
  for (const t of tribeMapping) {
    if (t.tribe_status === "Mergatory") {
      return Math.round(t.episode);
    }
  }
  // Older seasons: first "Merged" status IS the merge episode
  for (const t of tribeMapping) {
    if (t.tribe_status === "Merged") {
      return Math.round(t.episode);
    }
  }
  return null;
}

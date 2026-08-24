import { countBy, entries } from "lodash-es";
import {
  getActivePropBetKeys,
  PropBetQuestionKey,
  PropBetQuestionKeys,
  PropBetsQuestions,
} from "../data/propbets";
import {
  CastawayId,
  Challenge,
  Competition,
  Elimination,
  Episode,
  GameEvent,
  SlimUser,
} from "../types";

export type PropBetStatus =
  | "definitive_correct"
  | "definitive_incorrect"
  | "leading"
  | "pending";

/**
 * Why a bet stopped being pending. Names the concrete result that settled
 * the question and the episode it happened in, so a whole-season bet that
 * closes early (a medevac in episode 1, say) does not look like a mistake.
 */
export type PropBetResolutionReason =
  | "first_elimination"
  | "eliminated"
  | "winner"
  | "made_ftc"
  | "medical_evac"
  | "quit"
  | "shot_in_the_dark"
  | "first_idol"
  | "first_idol_play";

export type PropBetResolution = {
  reason: PropBetResolutionReason;
  episode_num: number;
  /** The castaway the resolving result belongs to, when there is one. */
  castaway_id?: CastawayId;
};

export type PropBetAnswer = {
  user_uid: SlimUser["uid"];
  user_name: SlimUser["displayName"];
  status: PropBetStatus;
  answer: string;
  points_awarded: number;
  /**
   * Set when a concrete result settled the bet. Absent while pending and
   * when only the finale settled it.
   */
  resolved_by?: PropBetResolution;
};

export type PropBetScores = Record<PropBetQuestionKey, PropBetAnswer> & {
  total: number;
};

export type PropBetScoresByUser = Record<SlimUser["uid"], PropBetScores>;

const makeEmptyAnswer = (
  uid: SlimUser["uid"],
  userName: string,
  answer = "",
): PropBetAnswer => ({
  user_uid: uid,
  user_name: userName,
  status: "pending",
  points_awarded: 0,
  answer,
});

const buildEmptyScores = (
  uid: SlimUser["uid"],
  userName: string,
  answers?: Partial<Record<PropBetQuestionKey, string>>,
): PropBetScores => {
  const propBetScores = PropBetQuestionKeys.reduce<
    Record<PropBetQuestionKey, PropBetAnswer>
  >(
    (accum, key) => {
      accum[key] = makeEmptyAnswer(uid, userName, answers?.[key] || "");
      return accum;
    },
    {} as Record<PropBetQuestionKey, PropBetAnswer>,
  );

  return {
    ...propBetScores,
    total: 0,
  };
};

export const getPropBetScoresByUser = (
  events: Record<GameEvent["id"], GameEvent>,
  eliminations: Record<Elimination["id"], Elimination>,
  challenges: Record<Challenge["id"], Challenge>,
  postMergeEpisodeNumbers: Set<Episode["order"]>,
  hasFinaleOccurred: boolean,
  competition?: Competition,
): PropBetScoresByUser => {
  if (!competition?.participant_uids || !competition.prop_bets) return {};

  const activeKeys = getActivePropBetKeys(competition.prop_bets);

  return competition.participant_uids.reduce<PropBetScoresByUser>((a, b) => {
    const scores = getPropBetScoresForUser(
      b,
      events,
      eliminations,
      challenges,
      postMergeEpisodeNumbers,
      hasFinaleOccurred,
      activeKeys,
      competition,
    );
    if (scores) {
      a[b] = scores;
    }
    return a;
  }, {});
};

/**
 * Determines if a player has been eliminated from the game in a way that
 * ends their chance of winning or reaching FTC. Excludes final_tribal_council
 * and switched variants (those don't end a player's run).
 * A player who returned (Edge of Extinction, Redemption Island) is NOT eliminated.
 */
const isEliminatedFromGame = (
  castawayId: string,
  elims: Elimination[],
  events: GameEvent[],
  challenges: Record<Challenge["id"], Challenge>,
): boolean => {
  const gameEndingElims = elims.filter(
    (x) =>
      x.castaway_id === castawayId &&
      x.variant !== "final_tribal_council" &&
      x.variant !== "switched",
  );
  if (gameEndingElims.length === 0) return false;

  const lastElimEpisode = Math.max(
    ...gameEndingElims.map((x) => x.episode_num),
  );

  const hasLaterEvent = events.some(
    (x) => x.castaway_id === castawayId && x.episode_num > lastElimEpisode,
  );
  if (hasLaterEvent) return false;

  const hasLaterChallengeWin = Object.values(challenges).some(
    (x) =>
      x.episode_num > lastElimEpisode &&
      x.winning_castaways?.includes(castawayId as CastawayId),
  );
  if (hasLaterChallengeWin) return false;

  return true;
};

/**
 * The elimination that took a castaway out of the game, used as the
 * resolution reason when a season-long pick can no longer come true.
 */
const lastGameEndingElim = (
  castawayId: string,
  elims: Elimination[],
): Elimination | undefined =>
  elims
    .filter(
      (x) =>
        x.castaway_id === castawayId &&
        x.variant !== "final_tribal_council" &&
        x.variant !== "switched",
    )
    .sort((a, b) => b.episode_num - a.episode_num)[0];

const elimResolution = (
  reason: PropBetResolutionReason,
  elim: Elimination,
): PropBetResolution => ({
  reason,
  episode_num: elim.episode_num,
  castaway_id: elim.castaway_id,
});

const eventResolution = (
  reason: PropBetResolutionReason,
  event: GameEvent,
): PropBetResolution => ({
  reason,
  episode_num: event.episode_num,
  castaway_id: event.castaway_id,
});

/**
 * Determines if a player is currently out of the game.
 * A player who was eliminated but later appears in events or challenge wins
 * (e.g., returned from Edge of Extinction) is NOT currently eliminated.
 */
const isCurrentlyEliminated = (
  castawayId: string,
  elims: Elimination[],
  events: GameEvent[],
  challenges: Record<Challenge["id"], Challenge>,
): boolean => {
  const playerElims = elims.filter((x) => x.castaway_id === castawayId);
  if (playerElims.length === 0) return false;

  const lastElimEpisode = Math.max(...playerElims.map((x) => x.episode_num));

  const hasLaterEvent = events.some(
    (x) => x.castaway_id === castawayId && x.episode_num > lastElimEpisode,
  );
  if (hasLaterEvent) return false;

  const hasLaterChallengeWin = Object.values(challenges).some(
    (x) =>
      x.episode_num > lastElimEpisode &&
      x.winning_castaways?.includes(castawayId as CastawayId),
  );
  if (hasLaterChallengeWin) return false;

  return true;
};

/**
 * Resolves the status of a cumulative leaderboard bet (most idols, most immunities).
 * Given a list of occurrences per player (sorted by count descending), determines
 * whether the picked player is leading, definitively behind, or pending.
 */
const resolveLeaderboardBetStatus = (
  rankedPlayers: [string, number][],
  pickedPlayer: string,
  isPickEliminated: boolean,
  hasFinaleOccurred: boolean,
): PropBetStatus => {
  const topCount = rankedPlayers[0]?.[1] ?? 0;
  const leaders = rankedPlayers
    .filter(([, count]) => count === topCount)
    .map(([name]) => name);

  const isLeading = topCount > 0 && leaders.includes(pickedPlayer);
  const pickCount =
    rankedPlayers.find(([name]) => name === pickedPlayer)?.[1] ?? 0;

  if (hasFinaleOccurred) {
    return isLeading ? "definitive_correct" : "definitive_incorrect";
  }
  if (isLeading) {
    return "leading";
  }
  if (isPickEliminated && pickCount < topCount) {
    return "definitive_incorrect";
  }
  return "pending";
};

type ResolvedStatus = { status: PropBetStatus; resolution?: PropBetResolution };

/**
 * Resolves a yes/no season-long bet. "Yes" is proven the moment the thing
 * happens; "No" is disproven at that same moment and only proven by the
 * finale. Returns the resolving result so the UI can show why it settled.
 */
const resolveBinarySeasonBetStatus = (
  answer: string | undefined,
  occurrence: PropBetResolution | undefined,
  hasFinaleOccurred: boolean,
): ResolvedStatus => {
  if (answer === "Yes") {
    if (occurrence) {
      return { status: "definitive_correct", resolution: occurrence };
    }
    if (hasFinaleOccurred) return { status: "definitive_incorrect" };
    return { status: "pending" };
  }

  if (answer === "No") {
    if (occurrence) {
      return { status: "definitive_incorrect", resolution: occurrence };
    }
    if (hasFinaleOccurred) return { status: "definitive_correct" };
  }

  return { status: "pending" };
};

/** Earliest elimination of a given variant, as a resolution. */
const firstElimOfVariant = (
  elims: Elimination[],
  variant: Elimination["variant"],
  reason: PropBetResolutionReason,
): PropBetResolution | undefined => {
  const match = elims
    .filter((x) => x.variant === variant)
    .sort((a, b) => a.episode_num - b.episode_num || a.order - b.order)[0];
  return match ? elimResolution(reason, match) : undefined;
};

/** Earliest event of a given action, as a resolution. */
const firstEventOfAction = (
  events: GameEvent[],
  action: GameEvent["action"],
  reason: PropBetResolutionReason,
): PropBetResolution | undefined => {
  const match = events
    .filter((x) => x.action === action)
    .sort((a, b) => a.episode_num - b.episode_num)[0];
  return match ? eventResolution(reason, match) : undefined;
};

export const getPropBetScoresForUser = (
  uid: SlimUser["uid"],
  events: Record<GameEvent["id"], GameEvent>,
  eliminations: Record<Elimination["id"], Elimination>,
  challenges: Record<Challenge["id"], Challenge>,
  postMergeEpisodeNumbers: Set<Episode["order"]>,
  hasFinaleOccurred: boolean,
  activeKeys: PropBetQuestionKey[],
  competition: Competition,
): PropBetScores => {
  const myPropBets = (competition?.prop_bets || []).find(
    (x) => x.user_uid === uid,
  )?.values;

  const _user = competition.participants.find((x) => x.uid === uid);

  const userName =
    competition.team_names?.[uid] || _user?.displayName || _user?.email || uid;
  const scores = buildEmptyScores(uid, userName, myPropBets);

  // bail if no data
  if (!myPropBets) return scores;

  const setStatus = (
    key: PropBetQuestionKey,
    status: PropBetStatus,
    resolution?: PropBetResolution,
  ) => {
    scores[key].status = status;
    if (resolution && status !== "pending") {
      scores[key].resolved_by = resolution;
    }
    if (activeKeys.includes(key) && status === "definitive_correct") {
      scores[key].points_awarded = PropBetsQuestions[key].point_value;
      scores.total += PropBetsQuestions[key].point_value;
    }
  };

  const _events = Object.values(events);
  const _elims = Object.values(eliminations);

  // --- propbet_first_vote ---
  const firstEpisodeElim = _elims.find((x) => x.order === 1);
  if (firstEpisodeElim) {
    const resolution = elimResolution("first_elimination", firstEpisodeElim);
    if (firstEpisodeElim.castaway_id === myPropBets.propbet_first_vote) {
      setStatus("propbet_first_vote", "definitive_correct", resolution);
    } else {
      setStatus("propbet_first_vote", "definitive_incorrect", resolution);
    }
  }
  // else: pending (no elimination data yet)

  // --- propbet_winner ---
  const winSurvivorEvent = _events.find((x) => x.action === "win_survivor");
  if (winSurvivorEvent) {
    const resolution = eventResolution("winner", winSurvivorEvent);
    if (winSurvivorEvent.castaway_id === myPropBets.propbet_winner) {
      setStatus("propbet_winner", "definitive_correct", resolution);
    } else {
      setStatus("propbet_winner", "definitive_incorrect", resolution);
    }
  } else if (
    myPropBets.propbet_winner &&
    isEliminatedFromGame(myPropBets.propbet_winner, _elims, _events, challenges)
  ) {
    const elim = lastGameEndingElim(myPropBets.propbet_winner, _elims);
    setStatus(
      "propbet_winner",
      "definitive_incorrect",
      elim && elimResolution("eliminated", elim),
    );
  }

  // --- propbet_ftc ---
  const ftcEvent = _events.find(
    (x) =>
      x.action === "make_final_tribal_council" &&
      x.castaway_id === myPropBets.propbet_ftc,
  );
  if (ftcEvent) {
    setStatus(
      "propbet_ftc",
      "definitive_correct",
      eventResolution("made_ftc", ftcEvent),
    );
  } else if (hasFinaleOccurred) {
    setStatus("propbet_ftc", "definitive_incorrect");
  } else if (
    myPropBets.propbet_ftc &&
    isEliminatedFromGame(myPropBets.propbet_ftc, _elims, _events, challenges)
  ) {
    const elim = lastGameEndingElim(myPropBets.propbet_ftc, _elims);
    setStatus(
      "propbet_ftc",
      "definitive_incorrect",
      elim && elimResolution("eliminated", elim),
    );
  }

  // --- propbet_medical_evac ---
  const evac = resolveBinarySeasonBetStatus(
    myPropBets.propbet_medical_evac,
    firstElimOfVariant(_elims, "medical", "medical_evac"),
    hasFinaleOccurred,
  );
  setStatus("propbet_medical_evac", evac.status, evac.resolution);

  // --- propbet_first_idol_found ---
  const firstIdolEvent = _events
    .filter((x) => x.action === "find_idol")
    .sort((a, b) => a.episode_num - b.episode_num)[0];
  if (firstIdolEvent) {
    setStatus(
      "propbet_first_idol_found",
      firstIdolEvent.castaway_id === myPropBets.propbet_first_idol_found
        ? "definitive_correct"
        : "definitive_incorrect",
      eventResolution("first_idol", firstIdolEvent),
    );
  }

  // --- propbet_first_successful_idol_play ---
  const firstSuccessfulIdolPlay = _events
    .filter((x) => x.action === "use_idol")
    .sort((a, b) => a.episode_num - b.episode_num)[0];
  if (firstSuccessfulIdolPlay) {
    setStatus(
      "propbet_first_successful_idol_play",
      firstSuccessfulIdolPlay.castaway_id ===
        myPropBets.propbet_first_successful_idol_play
        ? "definitive_correct"
        : "definitive_incorrect",
      eventResolution("first_idol_play", firstSuccessfulIdolPlay),
    );
  }

  // --- propbet_successful_shot_in_the_dark ---
  const shot = resolveBinarySeasonBetStatus(
    myPropBets.propbet_successful_shot_in_the_dark,
    firstEventOfAction(
      _events,
      "use_shot_in_the_dark_successfully",
      "shot_in_the_dark",
    ),
    hasFinaleOccurred,
  );
  setStatus(
    "propbet_successful_shot_in_the_dark",
    shot.status,
    shot.resolution,
  );

  // --- propbet_immunities ---
  const immunities = Object.values(challenges).filter(
    (x) =>
      x.variant === "immunity" && postMergeEpisodeNumbers.has(x.episode_num),
  );
  const allImmunityWinners = immunities.flatMap((x) => x.winning_castaways);
  const rankedImmunityWinners = entries(countBy(allImmunityWinners)).sort(
    (a, b) => b[1] - a[1],
  );
  setStatus(
    "propbet_immunities",
    resolveLeaderboardBetStatus(
      rankedImmunityWinners,
      myPropBets.propbet_immunities || "",
      isCurrentlyEliminated(
        myPropBets.propbet_immunities || "",
        _elims,
        _events,
        challenges,
      ),
      hasFinaleOccurred,
    ),
  );

  // --- propbet_rewards ---
  const rewards = Object.values(challenges).filter(
    (x) => x.variant === "reward" && postMergeEpisodeNumbers.has(x.episode_num),
  );
  const allRewardWinners = rewards.flatMap((x) => x.winning_castaways);
  const rankedRewardWinners = entries(countBy(allRewardWinners)).sort(
    (a, b) => b[1] - a[1],
  );
  setStatus(
    "propbet_rewards",
    resolveLeaderboardBetStatus(
      rankedRewardWinners,
      myPropBets.propbet_rewards || "",
      isCurrentlyEliminated(
        myPropBets.propbet_rewards || "",
        _elims,
        _events,
        challenges,
      ),
      hasFinaleOccurred,
    ),
  );

  // --- propbet_idols ---
  const idols = _events.filter((x) => x.action === "find_idol");
  const allIdolFinders = idols.map((x) => x.castaway_id);
  const rankedIdolFinders = entries(countBy(allIdolFinders)).sort(
    (a, b) => b[1] - a[1],
  );
  setStatus(
    "propbet_idols",
    resolveLeaderboardBetStatus(
      rankedIdolFinders,
      myPropBets.propbet_idols || "",
      isCurrentlyEliminated(
        myPropBets.propbet_idols || "",
        _elims,
        _events,
        challenges,
      ),
      hasFinaleOccurred,
    ),
  );

  // --- propbet_quit ---
  const quit = resolveBinarySeasonBetStatus(
    myPropBets.propbet_quit,
    firstElimOfVariant(_elims, "quitter", "quit"),
    hasFinaleOccurred,
  );
  setStatus("propbet_quit", quit.status, quit.resolution);

  return scores;
};

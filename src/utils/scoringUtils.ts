import { BASE_PLAYER_SCORING } from "../data/scoring";
import {
  CastawayId,
  Challenge,
  Elimination,
  GameEvent,
  PlayerAction,
} from "../types";

const addFixedActionPoints = (action: PlayerAction) =>
  BASE_PLAYER_SCORING.find((x) => x.action === action)?.fixed_value ?? 0;

export type ScoringActionEntry = {
  action: PlayerAction;
  points_awarded: number;
};

export type EnhancedScores = {
  episode_num: number;
  total: number;
  actions: ScoringActionEntry[];
};

export const getEnhancedSurvivorPoints = (
  challenges: Challenge[],
  eliminations: Elimination[],
  events: GameEvent[],
  episodeNumber: number,
  castawayId: CastawayId,
) => {
  const scores: EnhancedScores = {
    episode_num: episodeNumber,
    total: 0,
    actions: [],
  };

  const addToScores = (action: PlayerAction, points_awarded: number) => {
    scores.actions.push({ action, points_awarded });
    scores.total += points_awarded;
  };

  const _eliminations = eliminations?.filter(
    (x) => x.episode_num === episodeNumber,
  );
  const _challenges = challenges?.filter(
    (x) => x.episode_num === episodeNumber,
  );
  const _events = events?.filter((x) => x.episode_num === episodeNumber);

  _challenges?.forEach((c) => {
    if (c.winning_castaways.includes(castawayId)) {
      addToScores(c.variant, addFixedActionPoints(c.variant));
    }
  });

  // if the player was eliminated, give them points based on episode number;
  // in a multi-elimination episode, later eliminations earn +0.5 each
  _eliminations?.forEach((e) => {
    if (e.castaway_id !== castawayId) return;
    if (e.variant === "switched") return; // Not a real elimination

    const earlierSameEpisode = _eliminations.filter(
      (x) => x.variant !== "switched" && x.order < e.order,
    ).length;
    addToScores("eliminated", e.episode_num + earlierSameEpisode * 0.5);

    if (e.variant === "medical") {
      addToScores(
        "medically_evacuated",
        addFixedActionPoints("medically_evacuated"),
      );
    } else if (e.variant === "quitter") {
      addToScores("quitter", addFixedActionPoints("quitter"));
    } else if (e.variant === "ejected") {
      addToScores("ejected", addFixedActionPoints("ejected"));
    }
  });

  // Handle game events like finding idols etc
  _events.forEach((e) => {
    if (e.castaway_id !== castawayId) return;

    if (e.multiplier) {
      addToScores(e.action, addFixedActionPoints(e.action) * e.multiplier);
    } else {
      addToScores(e.action, addFixedActionPoints(e.action));
    }
  });

  return scores;
};

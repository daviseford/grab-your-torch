import type { PropBetQuestionKey } from "../../data/propbets";

/**
 * One clarifying line under a question whose wording leaves room to guess
 * wrong.
 *
 * Deliberately NOT in `src/data/propbets.ts`: that module is one of
 * `SCORING_REVISION_SOURCES`, so editing it invalidates every cached pool
 * standing. This is display copy and changes no score, so it must not cost a
 * recompute.
 */
export const PropBetHelp: Partial<Record<PropBetQuestionKey, string>> = {
  propbet_quit:
    "A castaway voluntarily removes themselves from the game. A medical evacuation or an ejection does not count.",
};

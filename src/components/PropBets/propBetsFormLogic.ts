import {
  PropBetQuestionKeys,
  type PropBetQuestionKey,
} from "../../data/propbets";
import type { CastawayLookup, Player, PropBetsFormData } from "../../types";
import { sortCastAlphabetically } from "../../utils/castOrder";

/**
 * The minimum a castaway must carry to be answerable in the form. A season's
 * `players` satisfy it, and so does a bare pool roster, which has no season
 * document behind it.
 */
export type PropBetRosterEntry = Pick<Player, "castaway_id" | "full_name">;

export type PropBetOption = { value: string; label: string };

/**
 * The castaway answers, alphabetical by display name so the cast list never
 * leaks survivoR's boot order. Labelled with the full name, which is what a
 * prop bet entry is read back under.
 */
export const buildPropBetOptions = (
  cast: readonly PropBetRosterEntry[],
  lookup?: CastawayLookup,
): PropBetOption[] =>
  sortCastAlphabetically(cast, lookup).map((player) => ({
    value: player.castaway_id,
    label: player.full_name,
  }));

/**
 * Form values covering every question: prefilled answers are kept, anything
 * missing becomes an empty answer. Keys outside the question set are dropped,
 * so a stale saved entry cannot introduce a field the form does not render.
 */
export const normalizePropBetValues = (
  initialValues?: PropBetsFormData,
): PropBetsFormData =>
  PropBetQuestionKeys.reduce<PropBetsFormData>((accum, key) => {
    accum[key] = initialValues?.[key] ?? "";
    return accum;
  }, {});

const answeredKeys = (values: PropBetsFormData): PropBetQuestionKey[] =>
  PropBetQuestionKeys.filter((key) => Boolean(values[key]));

/** How many of the questions currently carry an answer. */
export const countAnsweredPropBets = (values: PropBetsFormData): number =>
  answeredKeys(values).length;

/** True once every question has an answer, which is what submit requires. */
export const isPropBetFormComplete = (values: PropBetsFormData): boolean =>
  answeredKeys(values).length === PropBetQuestionKeys.length;

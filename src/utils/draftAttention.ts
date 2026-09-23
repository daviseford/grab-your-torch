import type { Draft } from "../types";

export type TurnAlertDraft = Pick<
  Draft,
  | "id"
  | "started"
  | "finished"
  | "current_pick_number"
  | "total_players"
  | "current_picker"
  | "participants"
  | "draft_picks"
>;

/**
 * The per-tab identity of a turn alert: `${draftId}:${pickNumber}` when the
 * viewer is the eligible drafter on the clock, else null. The viewer is not
 * in the key, so per-viewer separation lives in the storage slot the caller
 * namespaces by uid.
 */
export const turnAlertKey = (
  draft: TurnAlertDraft | undefined,
  viewerUid: string | undefined,
): string | null => {
  if (!draft || !viewerUid) return null;
  if (!draft.started || draft.finished) return null;
  if (draft.current_picker?.uid !== viewerUid) return null;
  if (!draft.participants.some((p) => p.uid === viewerUid)) return null;
  if (
    draft.current_pick_number < 1 ||
    draft.current_pick_number > draft.total_players
  ) {
    return null;
  }
  return `${draft.id}:${draft.current_pick_number}`;
};

/** The viewer also made the previous pick (a snake turnaround). */
export const isRepeatTurn = (
  draft: TurnAlertDraft | undefined,
  viewerUid: string | undefined,
): boolean => {
  if (!draft || !viewerUid) return false;
  const lastPick = draft.draft_picks[draft.draft_picks.length - 1];
  return (
    !!lastPick &&
    lastPick.order === draft.current_pick_number - 1 &&
    lastPick.user_uid === viewerUid
  );
};

export const turnAlertMessage = (repeat: boolean): string =>
  repeat
    ? "Snake turn: you pick again."
    : "Pick a castaway from the cast below.";

export type TurnAlertAction = "none" | "defer" | "alert";

/** What to do with a turn key given what this tab has already alerted. */
export const turnAlertAction = ({
  key,
  alertedKey,
  hidden,
}: {
  key: string | null;
  alertedKey: string | null;
  hidden: boolean;
}): TurnAlertAction => {
  if (key === null) return "none";
  if (key === alertedKey) return "none";
  if (hidden) return "defer";
  return "alert";
};

/**
 * The one-time mobile scroll to the prop-bet questions: only on the live
 * drafting-to-prop-bets transition, for a participant with outstanding bets,
 * on a narrow viewport, and only once per page visit.
 */
export const shouldNudgePropBets = (s: {
  phase: string;
  sawDrafting: boolean;
  alreadyNudged: boolean;
  isParticipant: boolean;
  hasSubmittedPropBets: boolean;
  narrow: boolean;
}): boolean =>
  s.phase === "prop-bets" &&
  s.sawDrafting &&
  !s.alreadyNudged &&
  s.isParticipant &&
  !s.hasSubmittedPropBets &&
  s.narrow;

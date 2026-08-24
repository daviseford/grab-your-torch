import { onValue, ref } from "firebase/database";
import { useEffect, useState } from "react";
import { rt_db } from "../firebase";
import type { Draft, SlimUser } from "../types";
import { normalizeDraft, type RealtimeDraft } from "../utils/draftRealtime";
import {
  getRecentDrafts,
  removeRecentDraft,
  type RecentDraftRecord,
} from "../utils/recentDrafts";
import { useUser } from "./useUser";

export type RecentDraftStatus = "lobby" | "your-turn" | "in-progress";

export type RecentDraft = {
  draft: Draft;
  /** Route matching AppRoutes: /seasons/:seasonId/draft/:draftId */
  url: string;
  status: RecentDraftStatus;
  visitedAt: number;
};

type RecentDraftState = {
  userUid: SlimUser["uid"];
  drafts: RecentDraft[];
};

export const buildRecentDraftForUser = (
  draft: Draft | undefined,
  record: RecentDraftRecord,
  userUid: SlimUser["uid"],
): RecentDraft | undefined => {
  if (
    !draft ||
    draft.finished ||
    !draft.participants.some((participant) => participant.uid === userUid)
  ) {
    return undefined;
  }

  const status: RecentDraftStatus = !draft.started
    ? "lobby"
    : draft.current_picker?.uid === userUid
      ? "your-turn"
      : "in-progress";

  return {
    draft,
    url: `/seasons/${record.seasonId}/draft/${record.draftId}`,
    status,
    visitedAt: record.visitedAt,
  };
};

/**
 * Live view of the drafts recorded in localStorage (see utils/recentDrafts).
 * Subscribes to each stored draft; finished or deleted drafts prune their
 * record and drop out of the result. Empty for signed-out users.
 */
export const useRecentDrafts = (): RecentDraft[] => {
  const { slimUser } = useUser();
  const userUid = slimUser?.uid;
  const [state, setState] = useState<RecentDraftState | null>(null);

  useEffect(() => {
    if (!userUid) {
      setState(null);
      return;
    }

    setState({ userUid, drafts: [] });
    const records = getRecentDrafts(userUid);
    const byId = new Map<string, RecentDraft>();
    const publish = () =>
      setState({
        userUid,
        drafts: [...byId.values()].sort((a, b) => b.visitedAt - a.visitedAt),
      });

    const unsubscribes = records.map((record) =>
      onValue(
        ref(rt_db, "drafts/" + record.draftId),
        (snapshot) => {
          const draft = normalizeDraft(snapshot.val() as RealtimeDraft | null);
          const recentDraft = buildRecentDraftForUser(draft, record, userUid);
          if (!recentDraft) {
            removeRecentDraft(userUid, record.draftId);
            byId.delete(record.draftId);
          } else {
            byId.set(record.draftId, recentDraft);
          }
          publish();
        },
        (error) => {
          console.error("Failed to read recent draft:", error);
          byId.delete(record.draftId);
          publish();
        },
      ),
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [userUid]);

  return state && state.userUid === userUid ? state.drafts : [];
};

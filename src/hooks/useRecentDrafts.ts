import { onValue, ref } from "firebase/database";
import { useEffect, useState } from "react";
import { rt_db } from "../firebase";
import type { Draft } from "../types";
import { normalizeDraft, type RealtimeDraft } from "../utils/draftRealtime";
import { getRecentDrafts, removeRecentDraft } from "../utils/recentDrafts";
import { useUser } from "./useUser";

export type RecentDraftStatus = "lobby" | "your-turn" | "in-progress";

export type RecentDraft = {
  draft: Draft;
  /** Route matching AppRoutes: /seasons/:seasonId/draft/:draftId */
  url: string;
  status: RecentDraftStatus;
  visitedAt: number;
};

/**
 * Live view of the drafts recorded in localStorage (see utils/recentDrafts).
 * Subscribes to each stored draft; finished or deleted drafts prune their
 * record and drop out of the result. Empty for signed-out users.
 */
export const useRecentDrafts = (): RecentDraft[] => {
  const { slimUser } = useUser();
  const [recentDrafts, setRecentDrafts] = useState<RecentDraft[]>([]);

  useEffect(() => {
    if (!slimUser) {
      setRecentDrafts([]);
      return;
    }

    const records = getRecentDrafts();
    const byId = new Map<string, RecentDraft>();
    const publish = () =>
      setRecentDrafts(
        [...byId.values()].sort((a, b) => b.visitedAt - a.visitedAt),
      );

    const unsubscribes = records.map((record) =>
      onValue(
        ref(rt_db, "drafts/" + record.draftId),
        (snapshot) => {
          const draft = normalizeDraft(snapshot.val() as RealtimeDraft | null);
          if (!draft || draft.finished) {
            removeRecentDraft(record.draftId);
            byId.delete(record.draftId);
          } else {
            const status: RecentDraftStatus = !draft.started
              ? "lobby"
              : draft.current_picker?.uid === slimUser.uid
                ? "your-turn"
                : "in-progress";
            byId.set(record.draftId, {
              draft,
              url: `/seasons/${record.seasonId}/draft/${record.draftId}`,
              status,
              visitedAt: record.visitedAt,
            });
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
  }, [slimUser]);

  return recentDrafts;
};

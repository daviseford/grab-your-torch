import { collection, onSnapshot, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { Competition, Trade } from "../types";

type TradesState = {
  competitionId?: Competition["id"];
  data: Trade[];
  loaded: boolean;
  error: Error | null;
};

/**
 * Trade documents are written by clients, so a malformed one can reach this
 * subscription. Skip anything we cannot sort or render rather than throwing
 * inside the snapshot callback and taking the whole trades UI down for every
 * participant — `allow delete: if false` means only an admin could clean it up.
 */
export const isRenderableTrade = (trade: Trade): boolean =>
  typeof trade?.created_at === "string" &&
  Array.isArray(trade.offered_castaway_ids) &&
  Array.isArray(trade.requested_castaway_ids);

/**
 * Live subscription to a competition's trades subcollection,
 * newest first.
 */
export const useTrades = (competitionId?: Competition["id"]) => {
  const [state, setState] = useState<TradesState>({
    competitionId,
    data: [],
    loaded: false,
    error: null,
  });

  useEffect(() => {
    setState((current) =>
      current.competitionId === competitionId &&
      current.data.length === 0 &&
      !current.loaded &&
      !current.error
        ? current
        : { competitionId, data: [], loaded: false, error: null },
    );

    if (!competitionId) return;

    const q = query(collection(db, "competitions", competitionId, "trades"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const trades = snap.docs
          .map((d) => d.data() as Trade)
          .filter(isRenderableTrade)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        setState((current) =>
          current.competitionId === competitionId
            ? { competitionId, data: trades, loaded: true, error: null }
            : current,
        );
      },
      (error) => {
        console.error("useTrades: onSnapshot error", error);
        setState((current) =>
          current.competitionId === competitionId
            ? { competitionId, data: [], loaded: false, error }
            : current,
        );
      },
    );

    return unsub;
  }, [competitionId]);

  if (state.competitionId !== competitionId) {
    return { data: [], loaded: false, error: null };
  }

  return { data: state.data, loaded: state.loaded, error: state.error };
};

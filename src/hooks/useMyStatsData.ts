import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import type { Competition, Trade } from "../types";
import {
  computeCompetitionOutcome,
  computeMyStats,
  sortOutcomes,
  type CompetitionOutcome,
  type MyStats,
} from "../utils/myStats";
import {
  isRenderableTrade,
  loadStatsSources,
  pickCurrent,
  type Keyed,
  type SourceReaders,
  type StatsSources,
} from "../utils/myStatsSources";
import { useUser } from "./useUser";

const readers: SourceReaders = {
  readDoc: async (name, id) => {
    const snap = await getDoc(doc(db, name, id));
    return snap.exists() ? snap.data() : undefined;
  },
  readTrades: async (competitionId) => {
    const snap = await getDocs(
      collection(db, "competitions", competitionId, "trades"),
    );
    return snap.docs.map((d) => d.data() as Trade).filter(isRenderableTrade);
  },
};

export type MyStatsData =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error" }
  | { status: "ready"; outcomes: CompetitionOutcome[]; stats: MyStats };

/**
 * Every competition the signed-in participant is in, scored the way its own
 * page scores it.
 *
 * Results are single documents per season, so they are read once per visit
 * (the `useEnteredPools` precedent) instead of holding a listener per season.
 * The competition list stays a live query, so a group advancing its episode
 * moves the numbers.
 *
 * All fetched state is tagged with the uid and attempt it was fetched for and
 * is ignored unless both still match. A slow response for the previous
 * account, or for a superseded retry, can therefore never render.
 */
export const useMyStatsData = (): MyStatsData & { retry: () => void } => {
  const { slimUser, isAuthReady } = useUser();
  const uid = slimUser?.uid;
  const [attempt, setAttempt] = useState(0);
  const [fetchedList, setFetchedList] =
    useState<Keyed<Competition[] | "error">>();
  const [fetchedSources, setFetchedSources] = useState<Keyed<StatsSources>>();
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(
        collection(db, "competitions"),
        where("participant_uids", "array-contains", uid),
      ),
      (snap) =>
        setFetchedList({
          uid,
          attempt,
          value: snap.docs.map((d) => d.data() as Competition),
        }),
      (error) => {
        // A failed read is an error state, never an empty list of zeros.
        console.error("useMyStatsData: competitions read failed", error);
        setFetchedList({ uid, attempt, value: "error" });
      },
    );
  }, [uid, attempt]);

  const list = pickCurrent(fetchedList, uid, attempt);

  // Results depend on which competitions exist, not on their episodes, so an
  // advancing boundary recomputes without refetching.
  const sourceKey = Array.isArray(list)
    ? list
        .map((c) => `${c.id}:${c.season_id}`)
        .sort()
        .join("|")
    : undefined;

  useEffect(() => {
    if (!uid || !Array.isArray(list)) return;
    let cancelled = false;
    loadStatsSources(list, readers).then((value) => {
      if (!cancelled) setFetchedSources({ uid, attempt, value });
    });
    return () => {
      cancelled = true;
    };
    // `list` is deliberately represented by `sourceKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, attempt, sourceKey]);

  const sources = pickCurrent(fetchedSources, uid, attempt);

  const ready = useMemo(() => {
    if (!uid || !Array.isArray(list) || !sources) return undefined;
    // Sources fetched for an earlier competition set: wait for the new ones.
    if (
      !list.every(
        (c) => c.season_id in sources.seasons && c.id in sources.trades,
      )
    )
      return undefined;
    const outcomes = sortOutcomes(
      list.map((c) =>
        computeCompetitionOutcome(
          c,
          sources.seasons[c.season_id],
          sources.trades[c.id],
          uid,
        ),
      ),
    );
    return { outcomes, stats: computeMyStats(outcomes) };
  }, [uid, list, sources]);

  if (!isAuthReady) return { status: "loading", retry };
  if (!uid) return { status: "signed-out", retry };
  if (list === "error") return { status: "error", retry };
  if (!ready) return { status: "loading", retry };
  return { status: "ready", ...ready, retry };
};

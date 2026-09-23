import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import type { Competition, Season, Trade } from "../types";
import type { CompetitionSeasonData } from "../utils/competitionResult";
import {
  applyResultRead,
  createResultsSession,
  planResultReads,
  resolveCompetitionResults,
  type CompetitionResultState,
  type ResultRead,
} from "../utils/competitionResultsSession";
import { isRenderableTrade } from "./useTrades";

export type { CompetitionResultState };

// Trades are one read per finished competition. Capping how many run at once
// keeps a long admin list from opening a burst of parallel requests.
const MAX_CONCURRENT_READS = 4;

const runLimited = async (tasks: (() => Promise<void>)[]) => {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_READS, tasks.length) },
      worker,
    ),
  );
};

const readSeasonData = async (
  seasonId: Season["id"],
): Promise<CompetitionSeasonData | null> => {
  const [season, challenges, eliminations, events] = await Promise.all(
    ["seasons", "challenges", "eliminations", "events"].map((name) =>
      getDoc(doc(db, name, seasonId)),
    ),
  );
  if (!season.exists()) return null;
  return {
    season: season.data() as Season,
    challenges: challenges.data() ?? {},
    eliminations: eliminations.data() ?? {},
    events: events.data() ?? {},
  } as CompetitionSeasonData;
};

const readTrades = async (competitionId: Competition["id"]) => {
  const snap = await getDocs(
    collection(db, "competitions", competitionId, "trades"),
  );
  return snap.docs.map((d) => d.data() as Trade).filter(isRenderableTrade);
};

const runRead = (read: ResultRead) =>
  read.kind === "season"
    ? readSeasonData(read.seasonId)
    : readTrades(read.competitionId);

/**
 * The final result of every finished competition in `competitions`, keyed by
 * competition id. Competitions that are not finished are answered without any
 * read, since a running competition has no winner to show.
 *
 * One-time reads rather than listeners, the same as this page's pool lookup: a
 * finished competition's results no longer change. Season data is read once
 * per season, however many competitions share it, and trades once per
 * finished competition, because a trade moves points and so can change who
 * won. Filtering or re-sorting the list reads nothing new.
 *
 * Reads are cached per signed-in session of `uid` (see `ResultsSession`): a
 * sign-out drops them, and reads that land after it are ignored.
 */
export const useCompetitionResults = (
  competitions: Competition[],
  uid: string | undefined,
): Record<string, CompetitionResultState> => {
  const [session, setSession] = useState(() => createResultsSession(uid));
  // A new uid, including none, starts a new session. Adjusting state during
  // render rather than in an effect means no render shows the old session.
  if (session.uid !== uid) setSession(createResultsSession(uid));

  const finished = useMemo(
    () => competitions.filter((c) => c.finished),
    [competitions],
  );

  useEffect(() => {
    if (session.uid !== uid) return;
    const { token } = session;
    const tasks = planResultReads(session, finished).map((read) => async () => {
      let data: CompetitionSeasonData | Trade[] | null = null;
      try {
        data = await runRead(read);
      } catch (error) {
        console.error(`useCompetitionResults: ${read.kind} read failed`, error);
      }
      setSession((current) => applyResultRead(current, token, read, data));
    });
    // Results that land after unmount are harmless: React ignores the
    // updates, and a remount starts a new session.
    void runLimited(tasks);
  }, [session, uid, finished]);

  return useMemo(
    () => resolveCompetitionResults(competitions, session, uid),
    [competitions, session, uid],
  );
};

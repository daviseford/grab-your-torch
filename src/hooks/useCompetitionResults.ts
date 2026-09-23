import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import type { Competition, Season, Trade } from "../types";
import {
  getCompetitionResult,
  type CompetitionResult,
  type CompetitionSeasonData,
} from "../utils/competitionResult";
import { isRenderableTrade } from "./useTrades";

/** Loading while its reads are in flight; unavailable when a read failed. */
export type CompetitionResultState =
  | CompetitionResult
  | { kind: "loading" }
  | { kind: "unavailable"; reason: "read-failed" };

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

/**
 * The final result of every finished competition in `competitions`, keyed by
 * competition id. Competitions that are not finished are answered without any
 * read, since a running competition has no winner to show.
 *
 * One-time reads rather than listeners, the same as this page's pool lookup: a
 * finished competition's results no longer change. Season data is read once
 * per season, however many competitions share it, and trades once per
 * finished competition, because a trade moves points and so can change who
 * won. Each read is made once per mount; filtering or re-sorting the list
 * reads nothing new.
 */
export const useCompetitionResults = (
  competitions: Competition[],
  enabled: boolean,
): Record<string, CompetitionResultState> => {
  const [seasonData, setSeasonData] = useState<
    Record<string, CompetitionSeasonData | null>
  >({});
  const [trades, setTrades] = useState<Record<string, Trade[] | null>>({});
  const requested = useRef(new Set<string>());

  const finished = useMemo(
    () => competitions.filter((c) => c.finished),
    [competitions],
  );

  useEffect(() => {
    if (!enabled) return;
    const tasks: (() => Promise<void>)[] = [];

    for (const { season_id } of finished) {
      const key = `season:${season_id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      tasks.push(async () => {
        let data: CompetitionSeasonData | null = null;
        try {
          data = await readSeasonData(season_id);
        } catch (error) {
          console.error("useCompetitionResults: season read failed", error);
        }
        setSeasonData((current) => ({ ...current, [season_id]: data }));
      });
    }

    for (const { id } of finished) {
      const key = `trades:${id}`;
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      tasks.push(async () => {
        let data: Trade[] | null = null;
        try {
          data = await readTrades(id);
        } catch (error) {
          console.error("useCompetitionResults: trades read failed", error);
        }
        setTrades((current) => ({ ...current, [id]: data }));
      });
    }

    // Results that land after unmount are harmless: React ignores the
    // updates, and a remount starts over with its own requested set.
    void runLimited(tasks);
  }, [enabled, finished]);

  return useMemo(() => {
    const results: Record<string, CompetitionResultState> = {};
    for (const competition of competitions) {
      if (!competition.finished) {
        results[competition.id] = { kind: "in-progress" };
        continue;
      }
      const data = seasonData[competition.season_id];
      const competitionTrades = trades[competition.id];
      if (data === undefined || competitionTrades === undefined) {
        results[competition.id] = { kind: "loading" };
      } else if (data === null || competitionTrades === null) {
        results[competition.id] = {
          kind: "unavailable",
          reason: "read-failed",
        };
      } else {
        results[competition.id] = getCompetitionResult(
          competition,
          data,
          competitionTrades,
        );
      }
    }
    return results;
  }, [competitions, seasonData, trades]);
};

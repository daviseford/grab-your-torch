import type { Competition, Trade } from "../types";
import type { SeasonResults } from "./myStats";

/**
 * The reads behind My Stats, with Firestore injected so the failure and
 * isolation rules can be tested without it.
 *
 * A read that fails, or a result document that does not exist, yields `null`
 * for that season or competition, never an empty record. An empty record would
 * score as zero points and silently turn a broken read into a bad finish.
 */
export type SourceReaders = {
  /** The document's data, or `undefined` when the document does not exist. */
  readDoc: (
    collection: "seasons" | "challenges" | "eliminations" | "events",
    id: string,
  ) => Promise<Record<string, unknown> | undefined>;
  readTrades: (competitionId: Competition["id"]) => Promise<Trade[]>;
};

export type StatsSources = {
  seasons: Record<string, SeasonResults | null>;
  trades: Record<string, Trade[] | null>;
};

const loadSeasonResults = async (
  readers: SourceReaders,
  seasonId: string,
): Promise<SeasonResults | null> => {
  try {
    const [season, challenges, eliminations, events] = await Promise.all([
      readers.readDoc("seasons", seasonId),
      readers.readDoc("challenges", seasonId),
      readers.readDoc("eliminations", seasonId),
      readers.readDoc("events", seasonId),
    ]);
    if (!season || !challenges || !eliminations || !events) return null;
    return {
      season: season as unknown as SeasonResults["season"],
      challenges: challenges as SeasonResults["challenges"],
      eliminations: eliminations as SeasonResults["eliminations"],
      events: events as SeasonResults["events"],
    };
  } catch (error) {
    console.error("myStats: season results read failed", seasonId, error);
    return null;
  }
};

const loadTrades = async (
  readers: SourceReaders,
  competitionId: Competition["id"],
): Promise<Trade[] | null> => {
  try {
    return await readers.readTrades(competitionId);
  } catch (error) {
    console.error("myStats: trades read failed", competitionId, error);
    return null;
  }
};

/**
 * Reads each distinct season once and each competition's trades once. Cost
 * grows with distinct seasons, not competitions. One failure only marks the
 * competitions that need it.
 */
export const loadStatsSources = async (
  competitions: Pick<Competition, "id" | "season_id">[],
  readers: SourceReaders,
): Promise<StatsSources> => {
  const seasonIds = [...new Set(competitions.map((c) => c.season_id))];
  const [seasonEntries, tradeEntries] = await Promise.all([
    Promise.all(
      seasonIds.map(async (id) => [id, await loadSeasonResults(readers, id)]),
    ),
    Promise.all(
      competitions.map(async (c) => [c.id, await loadTrades(readers, c.id)]),
    ),
  ]);
  return {
    seasons: Object.fromEntries(seasonEntries),
    trades: Object.fromEntries(tradeEntries),
  };
};

/** Same malformed-trade filter the competition page's subscription applies. */
export const isRenderableTrade = (trade: Trade): boolean =>
  typeof trade?.created_at === "string" &&
  Array.isArray(trade.offered_castaway_ids) &&
  Array.isArray(trade.requested_castaway_ids);

/** Fetched state tagged with the account and attempt it was fetched for. */
export type Keyed<T> = { uid: string; attempt: number; value: T };

/**
 * The tagged value only when it belongs to the current account and attempt.
 * This is the guard that keeps a slow response for the previous account, or a
 * superseded retry, from ever rendering.
 */
export const pickCurrent = <T>(
  keyed: Keyed<T> | undefined,
  uid: string | undefined,
  attempt: number,
): T | undefined =>
  keyed && uid !== undefined && keyed.uid === uid && keyed.attempt === attempt
    ? keyed.value
    : undefined;

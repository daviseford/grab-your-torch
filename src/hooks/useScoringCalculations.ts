import { sum } from "lodash-es";
import { useMemo } from "react";
import { Episode } from "../types";
import {
  filterEpisodesByMax,
  filterRecordByEpisode,
} from "../utils/episodeFilter";
import {
  getSeasonPointsByCastaway,
  getSeasonTotalsByCastaway,
} from "../utils/seasonPoints";
import { getOwnedCastawaysAtEpisode } from "../utils/tradeUtils";
import { useChallenges } from "./useChallenges";
import { useCompetition } from "./useCompetition";
import { useEliminations } from "./useEliminations";
import { useEvents } from "./useEvents";
import { usePropBetScoring } from "./useGetPropBetScoring";
import { useSeason } from "./useSeason";
import { useTrades } from "./useTrades";

export const useScoringCalculations = () => {
  const { data: competition } = useCompetition();
  const { data: season } = useSeason(competition?.season_id);
  const { data: challenges } = useChallenges(competition?.season_id);
  const { data: eliminations } = useEliminations(competition?.season_id);
  const { data: events } = useEvents(season?.id);
  const { data: trades } = useTrades(competition?.id);

  const { data: propBetScores, activeKeys } = usePropBetScoring();

  const maxEpisode = competition?.current_episode ?? null;

  const filteredEpisodes: Episode[] = useMemo(
    () => filterEpisodesByMax(season?.episodes || [], maxEpisode),
    [season?.episodes, maxEpisode],
  );

  const filteredChallenges = useMemo(
    () => filterRecordByEpisode(challenges || {}, maxEpisode),
    [challenges, maxEpisode],
  );

  const filteredEliminations = useMemo(
    () => filterRecordByEpisode(eliminations || {}, maxEpisode),
    [eliminations, maxEpisode],
  );

  const filteredEvents = useMemo(
    () => filterRecordByEpisode(events || {}, maxEpisode),
    [events, maxEpisode],
  );

  const survivorPointsByEpisode = useMemo(() => {
    if (!season?.players) return {};

    return getSeasonPointsByCastaway(
      Object.values(filteredChallenges),
      Object.values(filteredEliminations),
      Object.values(filteredEvents),
      filteredEpisodes,
      season.players.map((player) => player.castaway_id),
    );
  }, [
    filteredChallenges,
    filteredEliminations,
    filteredEvents,
    filteredEpisodes,
    season?.players,
  ]);

  const pointsByUserPerEpisode = useMemo(
    () =>
      competition?.participants.reduce<Record<string, number[]>>(
        (accum, participant) => {
          const { uid } = participant;

          const playerPointsPerEpisode = filteredEpisodes.map((e) => {
            // Ownership is resolved per episode so trades only move
            // future points — past points stay with the original owner.
            const ownedAtEpisode = getOwnedCastawaysAtEpisode(
              competition.draft_picks,
              trades,
              uid,
              e.order,
            );

            return sum(
              ownedAtEpisode.flatMap(
                (id) =>
                  (survivorPointsByEpisode || {})?.[id]?.[e.order - 1]?.total ||
                  0,
              ),
            );
          });

          accum[uid] = playerPointsPerEpisode;

          return accum;
        },
        {},
      ),
    [
      competition?.draft_picks,
      competition?.participants,
      filteredEpisodes,
      survivorPointsByEpisode,
      trades,
    ],
  );

  const pointsByUserPerEpisodeWithPropBets = useMemo(
    () =>
      Object.entries(pointsByUserPerEpisode || {}).reduce<
        Record<
          string,
          { episodePoints: number[]; propBetPoints: number; total: number }
        >
      >((accum, [uid, episodePoints]) => {
        const propBets = propBetScores[uid];
        const propBetPoints = propBets?.total || 0;

        accum[uid] = {
          episodePoints,
          propBetPoints,
          total: sum(episodePoints) + propBetPoints,
        };

        return accum;
      }, {}),
    [pointsByUserPerEpisode, propBetScores],
  );

  const survivorPointsTotalSeason = useMemo(
    () => getSeasonTotalsByCastaway(survivorPointsByEpisode),
    [survivorPointsByEpisode],
  );

  return {
    activePropBetKeys: activeKeys,
    filteredChallenges,
    filteredEpisodes,
    filteredEliminations,
    filteredEvents,
    propBetScores,
    survivorPointsTotalSeason,
    survivorPointsByEpisode,
    pointsByUserPerEpisode,
    pointsByUserPerEpisodeWithPropBets,
  };
};

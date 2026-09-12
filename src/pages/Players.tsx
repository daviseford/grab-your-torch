import { useMemo } from "react";
import { CastGallery } from "../components/Layout";
import { useSeason } from "../hooks/useSeason";
import { sortCastAlphabetically } from "../utils/castOrder";

export const Players = () => {
  const { data: season } = useSeason();

  // Season data lists the cast in boot order, which would spoil the season.
  const cast = useMemo(
    () =>
      season
        ? sortCastAlphabetically(season.players, season.castawayLookup)
        : [],
    [season],
  );

  if (!season) return null;

  return <CastGallery cast={cast} />;
};

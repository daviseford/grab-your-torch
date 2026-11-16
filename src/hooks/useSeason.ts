import { useParams } from "react-router-dom";
import { Season } from "../types";
import { useSharedSnapshot } from "./useSharedSnapshot";

export const useSeason = (id?: Season["id"]) => {
  const { seasonId } = useParams();
  const key = (id ?? seasonId) || undefined;

  const { data, loaded, fromCache, error } = useSharedSnapshot("seasons", key);
  return {
    data: data as Season | undefined,
    isLoading: !!key && !loaded,
    fromCache,
    error,
  };
};

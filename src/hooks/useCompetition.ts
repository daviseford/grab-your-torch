import { useParams } from "react-router-dom";
import { Competition } from "../types";
import { useSharedSnapshot } from "./useSharedSnapshot";
import { useUser } from "./useUser";

export const useCompetition = (id?: Competition["id"]) => {
  const { competitionId } = useParams();
  const { slimUser } = useUser();
  const key = id ?? competitionId;

  // Competition docs are readable only by signed-in users (firestore.rules),
  // so don't open a listener that is guaranteed to be denied. The page gate
  // handles the signed-out state; the listener opens once a user signs in.
  const { data, loaded, fromCache, error } = useSharedSnapshot(
    "competitions",
    slimUser ? key : undefined,
  );
  return {
    data: data as Competition | undefined,
    isLoading: !!key && !loaded,
    fromCache,
    error,
  };
};

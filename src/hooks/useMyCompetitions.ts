import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { Competition } from "../types";
import {
  listForUser,
  type UserScopedList,
} from "../utils/competitionResultsSession";
import { useUser } from "./useUser";

export const useMyCompetitions = () => {
  const { user } = useUser();
  const uid = user?.uid;

  const [list, setList] = useState<UserScopedList<Competition>>({
    uid: undefined,
    data: [],
  });

  useEffect(() => {
    if (!uid) return;

    const ref = collection(db, "competitions");
    const _query = query(ref, where("participant_uids", "array-contains", uid));

    const unsub = onSnapshot(
      _query,
      (snapshot) => {
        const _data = snapshot.docs.map((x) => x.data() as Competition);
        setList({ uid, data: _data });
      },
      (error) => {
        console.error("useMyCompetitions: onSnapshot error", error);
        setList({ uid, data: [] });
      },
    );

    return () => unsub();
  }, [uid]);

  // Tagging the list with its uid means a sign-out or account switch never
  // shows the previous user's competitions while the new snapshot loads.
  return {
    data: listForUser(list, uid),
    isLoading: !!uid && list.uid !== uid,
  };
};

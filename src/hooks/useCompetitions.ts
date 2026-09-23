import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { Competition } from "../types";
import {
  listForUser,
  type UserScopedList,
} from "../utils/competitionResultsSession";
import { useUser } from "./useUser";

export const useCompetitions = () => {
  const { slimUser } = useUser();
  const uid = slimUser?.uid;
  const isAdmin = !!slimUser?.isAdmin;

  const [list, setList] = useState<UserScopedList<Competition>>({
    uid: undefined,
    data: [],
  });

  useEffect(() => {
    if (!uid || !isAdmin) return;

    const ref = collection(db, "competitions");

    const unsub = onSnapshot(
      ref,
      (snapshot) => {
        const _data = snapshot.docs.map((x) => x.data() as Competition);
        setList({ uid, data: _data });
      },
      (error) => {
        console.error("useCompetitions: onSnapshot error", error);
      },
    );

    return () => unsub();
  }, [uid, isAdmin]);

  // Only an admin's own snapshot is returned: after a sign-out or a switch to
  // another account, the last admin snapshot is not shown to anyone else.
  return { data: listForUser(list, isAdmin ? uid : undefined) };
};

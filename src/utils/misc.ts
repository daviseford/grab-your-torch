import { SlimUser } from "../types";

// https://stackoverflow.com/a/31615643
export const getNumberWithOrdinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Signed point label: "+3", "-2", "0". */
export const formatPoints = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Display name for a participant uid. A per-competition team name (from
 * `Competition.team_names`) wins, then displayName, then email.
 */
export const getParticipantName = (
  participants: SlimUser[],
  uid: string,
  teamNames?: Record<string, string>,
): string => {
  const participant = participants.find((p) => p.uid === uid);
  return (
    teamNames?.[uid] ||
    participant?.displayName ||
    participant?.email ||
    "Unknown participant"
  );
};

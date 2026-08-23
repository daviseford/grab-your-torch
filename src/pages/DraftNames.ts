import type { SlimUser } from "../types";

/** A participant's display name: displayName, then email, then uid. */
export const participantName = (user: SlimUser) =>
  user.displayName || user.email || user.uid;

/** One uppercase initial for avatar plates. */
export const initialOf = (name: string) =>
  (name.trim().charAt(0) || "?").toUpperCase();

/** The given name, for the tight "About" and board cells. */
export const firstNameOf = (fullName: string) =>
  fullName.trim().split(/\s+/)[0];

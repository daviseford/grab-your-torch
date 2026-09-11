import { POOL_HANDLE_MAX } from "./poolHandle";

/** Use the account's display name, never the email fallback in SlimUser. */
export const poolUsername = (
  displayName: string | null | undefined,
): string => {
  const name = (displayName ?? "").replace(/[\p{C}]/gu, "").trim();
  let bounded = "";
  for (const character of name) {
    if (bounded.length + character.length > POOL_HANDLE_MAX) break;
    bounded += character;
  }
  return bounded.trim() || "Survivor fan";
};

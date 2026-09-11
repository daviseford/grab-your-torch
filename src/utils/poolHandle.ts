/** Pool entries store the account username in the legacy `handle` field.
 * Keep validation in sync with firestore.rules. Names render as plain text.
 */
export const POOL_HANDLE_MIN = 1;
export const POOL_HANDLE_MAX = 100;
export const POOL_HANDLE_PATTERN = /^[^\p{C}\u2060-\u206f]+$/u;
export type PoolHandleError = string;

export const validatePoolHandle = (handle: string): PoolHandleError | null => {
  if (!handle.length) return "Your account needs a username.";
  if (handle.length > POOL_HANDLE_MAX)
    return `Use ${POOL_HANDLE_MAX} characters or fewer.`;
  if (handle !== handle.trim())
    return "Usernames cannot start or end with a space.";
  if (!POOL_HANDLE_PATTERN.test(handle))
    return "Usernames cannot contain control or invisible characters.";
  return null;
};

// Retained for compatibility with callers creating legacy pool fixtures.
const HANDLE_FIRST = [
  "Torch",
  "Idol",
  "Merge",
  "Buff",
  "Tribe",
  "Fire",
  "Rice",
  "Shelter",
  "Reward",
  "Jury",
] as const;

const HANDLE_SECOND = [
  "Snuffer",
  "Hunter",
  "Chaser",
  "Keeper",
  "Watcher",
  "Caller",
  "Reader",
  "Runner",
] as const;

const pickFrom = <T>(items: readonly T[], value: number): T => {
  const index = Math.min(
    items.length - 1,
    Math.max(0, Math.floor(value * items.length)),
  );
  return items[index];
};

/**
 * A handle the validator always accepts. The entrant is free to replace it:
 * it is offered next to the field, never written into it on their behalf.
 */
export const suggestPoolHandle = (
  random: () => number = Math.random,
): string => {
  const first = pickFrom(HANDLE_FIRST, random());
  const second = pickFrom(HANDLE_SECOND, random());
  const digits = String(10 + Math.floor(random() * 89));
  return `${first}${second}${digits}`.slice(0, POOL_HANDLE_MAX);
};

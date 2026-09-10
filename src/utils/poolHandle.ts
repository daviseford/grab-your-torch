/**
 * Public handle rules, mirrored from `firestore.rules`.
 *
 * The security rules are the enforcement point (R10). This module exists so
 * the client rejects a bad handle *before* the write rather than after: a
 * denial arriving from Firestore at submit time looks like a broken page, and
 * the entrant has no way to tell which of the eight fields caused it.
 *
 * Keep this in step with the `handleIsValid()` function in `firestore.rules`.
 * The allowlist is not cosmetic: handles land on a crawlable public
 * leaderboard, so it is what keeps a URL, markup, a control character, a
 * zero-width joiner, or a bidi override off that page.
 */

export const POOL_HANDLE_MIN = 2;
export const POOL_HANDLE_MAX = 24;

/**
 * The rules regex, character for character:
 *   ^[A-Za-z0-9_-][A-Za-z0-9 _-]{0,22}[A-Za-z0-9_-]$
 *
 * Firestore's `matches()` is a full-string RE2 match. JavaScript's `$` also
 * matches immediately before a trailing newline, so a bare `.test()` here
 * would accept "torch\n" that the rules deny. NEWLINE_GUARD closes that gap.
 */
export const POOL_HANDLE_PATTERN =
  /^[A-Za-z0-9_-][A-Za-z0-9 _-]{0,22}[A-Za-z0-9_-]$/;

const NEWLINE_GUARD = /[\r\n]/;

export type PoolHandleError = string;

/**
 * Null when the handle is one the rules will accept, otherwise a short
 * sentence naming what to change.
 */
export const validatePoolHandle = (handle: string): PoolHandleError | null => {
  if (handle.length === 0) return "Enter a handle.";
  if (NEWLINE_GUARD.test(handle)) {
    return "Handles are a single line of text.";
  }
  if (handle.length < POOL_HANDLE_MIN) {
    return `Use at least ${POOL_HANDLE_MIN} characters.`;
  }
  if (handle.length > POOL_HANDLE_MAX) {
    return `Use ${POOL_HANDLE_MAX} characters or fewer.`;
  }
  if (handle !== handle.trim()) {
    return "Handles cannot start or end with a space.";
  }
  if (!POOL_HANDLE_PATTERN.test(handle)) {
    return "Use letters, numbers, spaces, hyphens, and underscores only.";
  }
  return null;
};

// The suggestion affordance. Deliberately takes a random source and nothing
// else: there is no parameter through which an account display name could
// reach it. Google supplies legal names, and this page is public and
// crawlable, so a handle is chosen, never inherited (R5).
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

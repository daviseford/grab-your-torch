/** A list read by a subscription, tagged with the uid it was read for. */
export type UserScopedList<T> = { uid: string | undefined; data: T[] };

/**
 * `list.data` when it was read for `uid`, otherwise an empty list. A list
 * subscription keeps its last snapshot until the next one arrives, so without
 * this a sign-out or account switch would show the previous user's list.
 */
export const listForUser = <T>(
  list: UserScopedList<T>,
  uid: string | undefined,
): T[] => (uid && list.uid === uid ? list.data : []);

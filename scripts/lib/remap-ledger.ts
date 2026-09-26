/**
 * The castaway id remap ledger, as the other jobs see it.
 *
 * `yarn remap-castaway-ids` records a season's cutover in
 * `admin_migrations/castaway_id_remap_season_N`. While that cutover is
 * `in_progress`, stored documents are a mix of provisional and survivoR ids,
 * so the jobs that write castaway ids for the season hold: the season push
 * (sync, push-seasons, new-season) and the ADP recompute. These checks are
 * code, not a runbook step, so a scheduled run cannot slip through during the
 * window. The abandoned-draft cleanup is kept structurally unable to touch
 * Firestore, so it cannot read this ledger; it writes no castaway field, and
 * docs/castaway-id-mapping.md covers it as an operational control.
 *
 * Pure except `readRemapLedgerStatus`, which takes the smallest possible
 * Firestore surface so it can be tested against the emulator.
 */

export const REMAP_LEDGER_COLLECTION = "admin_migrations";

export const remapLedgerDocId = (seasonNum: number) =>
  `castaway_id_remap_season_${seasonNum}`;

/** `admin_migrations/castaway_id_remap_season_N`. */
export const remapLedgerPath = (seasonId: `season_${number}`): string =>
  `${REMAP_LEDGER_COLLECTION}/castaway_id_remap_${seasonId}`;

/**
 * - `none`: no cutover has started (no ledger document).
 * - `in_progress`: the cutover started and has not been finalized. Stored
 *   documents may be on either side; every other job holds.
 * - `finalized`: every document that existed at the cutover is on survivoR's
 *   ids, checked and recorded by `--finalize`. Forward repairs only.
 * - `rolled_back`: every mark was rolled back inside the window; the season is
 *   provisional again.
 */
export type RemapLedgerStatus =
  | "none"
  | "in_progress"
  | "finalized"
  | "rolled_back";

/** A ledger document written before statuses existed counts as in progress. */
export const ledgerStatusOf = (data: unknown): RemapLedgerStatus => {
  if (data === null || data === undefined) return "none";
  const status = (data as { status?: unknown }).status;
  return status === "finalized" || status === "rolled_back"
    ? status
    : "in_progress";
};

type LedgerReader = {
  doc(path: string): {
    get(): Promise<{ exists: boolean; data(): unknown }>;
  };
};

export async function readRemapLedgerStatus(
  firestore: LedgerReader,
  seasonId: `season_${number}`,
): Promise<RemapLedgerStatus> {
  const snap = await firestore.doc(remapLedgerPath(seasonId)).get();
  return snap.exists ? ledgerStatusOf(snap.data()) : "none";
}

/** Which side of the remap a bundled season file is on, if it has a mapping. */
export type BundledCastState = "provisional" | "remapped" | "neither" | null;

/**
 * Why pushing a bundled season to Firestore must not happen now, or null.
 *
 * During the cutover nothing may push. Afterwards, the bundle must be on the
 * same side as production: pushing a provisional bundle over a finalized
 * season would put the old ids back on the season document, and pushing a
 * remapped bundle before the cutover would put survivoR's ids next to
 * provisional picks.
 */
export const seasonPushRefusal = (
  seasonId: string,
  status: RemapLedgerStatus,
  bundle: BundledCastState,
): string | null => {
  if (status === "in_progress") {
    return `the castaway id remap of ${seasonId} is in progress; finalize or roll it back first`;
  }
  if (status === "finalized" && bundle !== null && bundle !== "remapped") {
    return `${seasonId} was remapped to survivoR's ids, but the bundled season file is ${bundle}`;
  }
  if (status !== "finalized" && bundle === "remapped") {
    return `the bundled ${seasonId} file is on survivoR's ids, but production has not been remapped`;
  }
  if (bundle === "neither") {
    return `the bundled ${seasonId} cast matches neither side of its committed id mapping`;
  }
  return null;
};

/**
 * Whether a Realtime Database URL belongs to `projectId`. Accepts the
 * default instance and a same-named instance on either host, and the
 * emulator's `?ns=` form. The service account's project alone does not bind
 * the RTDB instance: `VITE_FIREBASE_DATABASE_URL` comes from the environment.
 */
export const databaseUrlRefusal = (
  url: string | null | undefined,
  projectId: string | null | undefined,
): string | null => {
  if (!url) return "no Realtime Database URL is configured";
  if (!projectId) return "the service account has no project id";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `the Realtime Database URL ${url} is not a URL`;
  }
  const ns = parsed.searchParams.get("ns");
  const host = parsed.hostname;
  const instance =
    ns ??
    (host.endsWith(".firebaseio.com") || host.endsWith(".firebasedatabase.app")
      ? host.split(".")[0]
      : null);
  if (instance === null) {
    return `the Realtime Database URL ${url} is not a Firebase database`;
  }
  return instance === projectId || instance === `${projectId}-default-rtdb`
    ? null
    : `the Realtime Database URL ${url} does not belong to project ${projectId}`;
};

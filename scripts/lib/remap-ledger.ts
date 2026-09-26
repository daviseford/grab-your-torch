/**
 * The castaway id remap ledger, as the other jobs see it.
 *
 * `yarn remap-castaway-ids` records a season's cutover in
 * `admin_migrations/castaway_id_remap_season_N`. While that cutover is
 * `in_progress`, stored documents are a mix of provisional and survivoR ids,
 * so the scripts that write castaway ids for the season hold: every season
 * push route (sync, push-seasons, push-all-seasons, new-season,
 * batch-new-season), the ADP recompute, pool pick repair, sample fixtures and
 * the legacy name-to-id migration. These checks are code, not a runbook step,
 * so a scheduled run cannot slip through during the window.
 *
 * The abandoned-draft cleanup is the exception. It is kept structurally unable
 * to touch Firestore (so it can never reach a pool), so it cannot read this
 * ledger. It never writes a castaway id, but it does delete whole unfinished
 * drafts, and a census draft it deletes can no longer be rolled back, which
 * stops a rollback before the season document. So the runbook disables its
 * workflow for the whole window (docs/castaway-id-mapping.md).
 *
 * Pure except the readers, which take the smallest possible Firestore surface
 * so they can be tested against the emulator.
 */

import * as fs from "fs";
import * as path from "path";
import {
  type CastawayIdMappingFile,
  classifyCommittedCast,
} from "./castaway-id-remap.js";

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

/**
 * Which side of a committed castaway id mapping a bundled cast
 * (`SEASON_N_CASTAWAY_LOOKUP`) is on, or null for a season with no mapping.
 */
export function bundledCastState(
  seasonNum: number,
  castawayLookup: unknown,
): BundledCastState {
  const file = path.resolve(
    import.meta.dirname,
    "..",
    "castaway-id-remaps",
    `season_${seasonNum}.json`,
  );
  if (!fs.existsSync(file)) return null;
  const mapping = JSON.parse(
    fs.readFileSync(file, "utf-8"),
  ) as CastawayIdMappingFile;
  const cast = Object.entries(
    (castawayLookup ?? {}) as Record<
      string,
      { full_name: string; castaway: string }
    >,
  ).map(([castaway_id, v]) => ({ castaway_id, ...v }));
  return classifyCommittedCast(cast, mapping.mappings);
}

/**
 * The one check every route that pushes a bundled season (the season
 * document or any of its result collections) must pass before writing:
 * `pushSeasonToFirestore` (sync, push-all-seasons, new-season,
 * batch-new-season) and `push-seasons`.
 */
export async function seasonPushGate(
  firestore: LedgerReader,
  seasonNum: number,
  castawayLookup: unknown,
): Promise<string | null> {
  const seasonId = `season_${seasonNum}` as const;
  return seasonPushRefusal(
    seasonId,
    await readRemapLedgerStatus(firestore, seasonId),
    bundledCastState(seasonNum, castawayLookup),
  );
}

/**
 * For the other scripts that write castaway ids of a season (pool pick
 * repair, sample and e2e fixtures): refuse while its cutover is in progress,
 * when a document they wrote would be neither in the census nor on a known
 * side.
 */
export async function remapInProgressRefusal(
  firestore: LedgerReader,
  seasonId: `season_${number}`,
  job: string,
): Promise<string | null> {
  return (await readRemapLedgerStatus(firestore, seasonId)) === "in_progress"
    ? `${job} would write castaway ids for ${seasonId} while its castaway id remap is in progress; finalize or roll it back first`
    : null;
}

/**
 * The Admin SDK sends Firestore and Realtime Database traffic to an emulator
 * whenever `FIRESTORE_EMULATOR_HOST` or `FIREBASE_DATABASE_EMULATOR_HOST` is
 * set, whatever project it was initialized with. A plan read with one of them
 * set would describe the emulator while claiming the real project, and a write
 * could land half in each. So: both or neither, and emulators only with a
 * `demo-` project (which cannot exist in the cloud).
 */
export const emulatorTargetRefusal = (
  env: Readonly<Record<string, string | undefined>>,
  projectId: string | null | undefined,
): string | null => {
  const firestore = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const database = Boolean(env.FIREBASE_DATABASE_EMULATOR_HOST);
  const demo = (projectId ?? "").startsWith("demo-");
  if (firestore !== database) {
    return `only one emulator is configured (${firestore ? "FIRESTORE_EMULATOR_HOST" : "FIREBASE_DATABASE_EMULATOR_HOST"}); set both or neither`;
  }
  if (firestore && !demo) {
    return `emulator hosts are set, so ${projectId} would not be the project read or written; unset them`;
  }
  if (!firestore && demo) {
    return `${projectId} is a demo project but no emulator is configured`;
  }
  return null;
};

import { SCORING_REVISION } from "../data/scoringRevision.generated";
import { Episode, SeasonRevisionPayload, SeasonRevisionStamp } from "../types";
import { canonicalJson, contentHash } from "./contentHash";

/**
 * The season-data revision: one content hash over the four collections a
 * derived score depends on.
 *
 * Three parties in two runtimes have to agree on it -- the Node push in
 * `scripts/lib/firebase-push.ts`, every admin CRUD path in the browser, and
 * the recompute job -- and a mismatch fails silently in both directions. So
 * the computation lives here, is pure, and is imported rather than
 * re-described. The sync push is not the only writer: an admin correction
 * that left the revision alone would leave a derived cache looking fresh and
 * being wrong.
 */

/**
 * Episodes arrive as an array, appended to by `arrayUnion`, so their stored
 * order carries no meaning. Sorting by id keeps a reordering from reading as
 * a data change while still catching an added, edited, or removed episode.
 */
function normalizeEpisodes(episodes: readonly unknown[]): unknown[] {
  return [...episodes].sort((a, b) => {
    const idA = canonicalJson((a as Episode | undefined)?.id ?? a);
    const idB = canonicalJson((b as Episode | undefined)?.id ?? b);
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}

export function computeSeasonDataRevision(
  payload: SeasonRevisionPayload,
): string {
  return contentHash(
    canonicalJson({
      episodes: normalizeEpisodes(payload.episodes ?? []),
      challenges: payload.challenges ?? {},
      eliminations: payload.eliminations ?? {},
      events: payload.events ?? {},
    }),
  );
}

/**
 * The pair every season-data writer stamps onto `seasons/{seasonId}`.
 *
 * The scoring revision is a build-time constant rather than a runtime hash of
 * source files, so the Node job and the browser bundle read literally the
 * same value (see scripts/generate-scoring-revision.ts).
 */
export function buildSeasonRevisionStamp(
  payload: SeasonRevisionPayload,
): SeasonRevisionStamp {
  return {
    data_revision: computeSeasonDataRevision(payload),
    scoring_revision: SCORING_REVISION,
  };
}

/* ------------------------------------------------------------------ *
 * Mutation helpers
 *
 * Every admin CRUD path computes the payload its write is about to create
 * and stamps the revision from it, in the same write. These helpers exist so
 * that "what the collection looks like after this write" is one tested
 * expression rather than eight hand-rolled spreads.
 * ------------------------------------------------------------------ */

export function upsertById<T extends { id: string }>(
  record: object,
  item: T,
): Record<string, unknown> {
  return { ...(record as Record<string, unknown>), [item.id]: item };
}

export function removeById(
  record: object,
  id: string,
): Record<string, unknown> {
  const next = { ...(record as Record<string, unknown>) };
  delete next[id];
  return next;
}

export function upsertEpisode(
  episodes: readonly unknown[],
  episode: Episode,
): unknown[] {
  const exists = episodes.some((e) => (e as Episode)?.id === episode.id);
  return exists
    ? episodes.map((e) => ((e as Episode)?.id === episode.id ? episode : e))
    : [...episodes, episode];
}

export function removeEpisode(
  episodes: readonly unknown[],
  id: Episode["id"],
): unknown[] {
  return episodes.filter((e) => (e as Episode)?.id !== id);
}

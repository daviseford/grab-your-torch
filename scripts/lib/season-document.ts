import { buildSeasonRevisionStamp } from "../../src/utils/seasonRevision.js";

interface SeasonDocumentInput {
  seasonNum: number;
  seasonImg: string;
  players: unknown;
  episodes: unknown;
  castawayLookup: unknown;
  /**
   * The other three collections in the same push. They are not stored on the
   * season document; they are hashed into `data_revision` alongside the
   * episodes, so a derived cache can tell whether it was built from this
   * data. Required rather than optional on purpose: a caller that forgot one
   * would publish a revision that quietly ignored a whole collection.
   */
  challenges: unknown;
  eliminations: unknown;
  events: unknown;
  syncedAt?: Date;
}

export function buildSeasonDocument({
  seasonNum,
  seasonImg,
  players,
  episodes,
  castawayLookup,
  challenges,
  eliminations,
  events,
  syncedAt = new Date(),
}: SeasonDocumentInput): Record<string, unknown> {
  const revision = buildSeasonRevisionStamp({
    episodes: (episodes ?? []) as readonly unknown[],
    challenges: (challenges ?? {}) as Record<string, unknown>,
    eliminations: (eliminations ?? {}) as Record<string, unknown>,
    events: (events ?? {}) as Record<string, unknown>,
  });

  return {
    id: `season_${seasonNum}`,
    order: seasonNum,
    name: `Survivor ${seasonNum}`,
    img: seasonImg,
    players,
    episodes,
    castawayLookup,
    last_synced_at: syncedAt.toISOString(),
    ...revision,
  };
}

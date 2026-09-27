import * as path from "path";
import { describe, expect, it } from "vitest";
import { regenerateSeasonFile } from "../curated-cast";
import { formatSeasonSource, planSeasonFileWrite } from "../season-file-change";
import type { SurvivorSeasonData } from "../survivor-client";
import { transformPlayers } from "../survivor-transformer";
import type { SurvivorCastaway } from "../survivor-types";
import type { ScrapeResultsOutput } from "../types";

// Only used to resolve the repo's Prettier config; nothing is read or written.
const SEASON_FILE = path.resolve(
  import.meta.dirname,
  "../../../src/data/season_51/index.ts",
);

const cast = transformPlayers(
  {
    castaways: [
      ["US0752", "Aaliyah Puglia", "Aaliyah"],
      ["US0763", "Jenna Doore", "Jenna"],
    ].map(
      ([castaway_id, full_name, castaway]) =>
        ({
          version: "US",
          season: 51,
          castaway_id,
          full_name,
          castaway,
          age: 30,
          city: "Toledo",
          state: "Ohio",
        }) as SurvivorCastaway,
    ),
  } as SurvivorSeasonData,
  51,
);

const results = (episodeCount: number): ScrapeResultsOutput => ({
  seasonNum: 51,
  scrapedAt: "2026-10-01T00:00:00.000Z",
  episodes: Array.from({ length: episodeCount }, (_, i) => ({
    order: i + 1,
    title: `Episode ${i + 1}`,
    airDate: "",
    isFinale: false,
    postMerge: false,
    mergeOccurs: false,
  })),
  challenges: [],
  eliminations: [
    {
      episodeNum: 1,
      castawayId: "US0763",
      voteString: "5-3",
      variant: "tribal",
      finishText: "1st voted out",
      order: 1,
    },
  ],
  events: [],
  voteHistory: [],
  warnings: [],
});

/** The file as the sync workflow commits it: codegen, then `yarn format`. */
const committedAfterSync = async (episodeCount: number) =>
  formatSeasonSource(
    regenerateSeasonFile(undefined, cast, results(episodeCount), 51).content,
    SEASON_FILE,
  );

describe("planSeasonFileWrite", () => {
  it("reports no change when survivoR has nothing new, though the raw codegen differs", async () => {
    const committed = await committedAfterSync(1);
    const { content: raw } = regenerateSeasonFile(
      committed,
      cast,
      results(1),
      51,
    );

    // The old comparison: raw codegen never equals the formatted file, so
    // every nightly run looked like a change and re-pushed Firestore.
    expect(raw).not.toBe(committed);

    const plan = await planSeasonFileWrite(committed, raw, SEASON_FILE);
    expect(plan.unchanged).toBe(true);
    expect(plan.content).toBe(committed);
  });

  it("reports a change, and writes the formatted file, when survivoR adds an episode", async () => {
    const committed = await committedAfterSync(1);
    const { content: raw } = regenerateSeasonFile(
      committed,
      cast,
      results(2),
      51,
    );

    const plan = await planSeasonFileWrite(committed, raw, SEASON_FILE);
    expect(plan.unchanged).toBe(false);
    expect(plan.content).toBe(await committedAfterSync(2));
    expect(plan.content).toContain('id: "episode_2"');
  });

  it("reports a change when there is no committed file", async () => {
    const { content: raw } = regenerateSeasonFile(
      undefined,
      cast,
      results(1),
      51,
    );

    const plan = await planSeasonFileWrite(undefined, raw, SEASON_FILE);
    expect(plan.unchanged).toBe(false);
    expect(plan.content).toBe(await committedAfterSync(1));
  });
});

import { describe, expect, it } from "vitest";
import { SCORING_REVISION } from "../../../src/data/scoringRevision.generated.js";
import { buildSeasonDocument } from "../season-document";

const base = {
  seasonNum: 50,
  seasonImg: "/season-50.webp",
  players: [],
  episodes: [] as unknown[],
  castawayLookup: {},
  challenges: {} as Record<string, unknown>,
  eliminations: {} as Record<string, unknown>,
  events: {} as Record<string, unknown>,
  syncedAt: new Date("2026-03-12T14:00:00.000Z"),
};

describe("buildSeasonDocument", () => {
  it("adds one ISO sync timestamp to every season payload", () => {
    expect(buildSeasonDocument(base)).toMatchObject({
      id: "season_50",
      order: 50,
      name: "Survivor 50",
      img: "/season-50.webp",
      last_synced_at: "2026-03-12T14:00:00.000Z",
    });
  });

  it("stamps both revisions on the season document", () => {
    const doc = buildSeasonDocument(base);

    expect(doc.scoring_revision).toBe(SCORING_REVISION);
    expect(doc.data_revision).toEqual(expect.any(String));
  });

  it("produces the same data revision for two builds of identical data", () => {
    expect(buildSeasonDocument(base).data_revision).toBe(
      buildSeasonDocument({ ...base, syncedAt: new Date() }).data_revision,
    );
  });

  it("changes the data revision when a single event changes", () => {
    const withEvent = buildSeasonDocument({
      ...base,
      events: { event_a: { id: "event_a", action: "find_idol" } },
    });

    expect(withEvent.data_revision).not.toBe(
      buildSeasonDocument(base).data_revision,
    );
  });

  it("changes the data revision for challenges and eliminations too", () => {
    const baseRevision = buildSeasonDocument(base).data_revision;

    expect(
      buildSeasonDocument({
        ...base,
        challenges: { challenge_a: { id: "challenge_a", order: 1 } },
      }).data_revision,
    ).not.toBe(baseRevision);

    expect(
      buildSeasonDocument({
        ...base,
        eliminations: { elimination_a: { id: "elimination_a", order: 1 } },
      }).data_revision,
    ).not.toBe(baseRevision);
  });
});

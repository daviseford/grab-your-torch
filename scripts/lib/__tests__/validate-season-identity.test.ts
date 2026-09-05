import { describe, expect, it } from "vitest";
import type {
  ScrapedPlayer,
  ScrapeResult,
  ScrapeResultsOutput,
} from "../types";
import { validateSeasonData } from "../validate-season";

const player = (castawayId: string, localName: string): ScrapedPlayer => ({
  wikiPageTitle: localName,
  localName,
  castawayId,
  matchStatus: "exact",
});

const playerData = (players: ScrapedPlayer[]): ScrapeResult => ({
  seasonNum: 51,
  scrapedAt: "2026-09-05T00:00:00.000Z",
  players,
  unmatched: [],
});

const emptyResults: ScrapeResultsOutput = {
  seasonNum: 51,
  scrapedAt: "2026-09-05T00:00:00.000Z",
  episodes: [],
  challenges: [],
  eliminations: [],
  events: [],
  voteHistory: [],
  warnings: [],
};

const committed = [
  { castawayId: "US0752", fullName: "Aaliyah Puglia" },
  { castawayId: "US0753", fullName: "Alexis Levine" },
];

describe("validateSeasonData castaway identity guard", () => {
  it("passes when ids and names are unchanged", () => {
    const result = validateSeasonData(
      playerData([
        player("US0752", "Aaliyah Puglia"),
        player("US0753", "Alexis Levine"),
        player("US0754", "Ana Sani"),
      ]),
      emptyResults,
      undefined,
      committed,
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("fails when a committed name comes back under a different id", () => {
    const result = validateSeasonData(
      playerData([
        player("US0752", "Alexis Levine"),
        player("US0753", "Aaliyah Puglia"),
      ]),
      emptyResults,
      undefined,
      committed,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Castaway "Aaliyah Puglia" changed id from US0752 to US0753',
    );
    expect(result.errors).toContain(
      'Castaway "Alexis Levine" changed id from US0753 to US0752',
    );
  });

  it("fails when a committed id disappears", () => {
    const result = validateSeasonData(
      playerData([player("US0752", "Aaliyah Puglia")]),
      emptyResults,
      undefined,
      committed,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "Castaway US0753 (Alexis Levine) is in the committed file but missing from the new data",
    ]);
  });

  it("only warns when the same id carries a corrected name", () => {
    const result = validateSeasonData(
      playerData([
        player("US0752", "Aaliyah Puglia"),
        player("US0753", "Alexis R. Levine"),
      ]),
      emptyResults,
      undefined,
      committed,
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      'Castaway US0753 renamed from "Alexis Levine" to "Alexis R. Levine"',
    ]);
  });

  it("is skipped when there is no committed cast", () => {
    const result = validateSeasonData(
      playerData([player("US0752", "Aaliyah Puglia")]),
      emptyResults,
      undefined,
      [],
    );
    expect(result.valid).toBe(true);
  });
});

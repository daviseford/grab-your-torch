import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import type { MergedPlayer } from "../codegen";
import {
  keepCuratedCast,
  readCommittedCast,
  regenerateSeasonFile,
} from "../curated-cast";
import type { SurvivorSeasonData } from "../survivor-client";
import { transformPlayers } from "../survivor-transformer";
import type { SurvivorCastaway } from "../survivor-types";
import type { ScrapeResultsOutput } from "../types";

const SEASON_51_FILE = path.resolve(
  import.meta.dirname,
  "../../../src/data/season_51/index.ts",
);

/**
 * The Season 51 castaways rows of doehm/survivoR@7336413, reduced to the
 * columns transformPlayers reads. survivoR disagrees with the committed cast
 * on three ages and three hometowns and has no professions at all.
 */
const SURVIVOR_51_CASTAWAYS: Array<
  [
    id: string,
    fullName: string,
    castaway: string,
    age: number,
    city: string | null,
    state: string,
  ]
> = [
  ["US0752", "Aaliyah Puglia", "Aaliyah", 24, "Providence", "Rhode Island"],
  ["US0753", "Alexis Levine", "Alexis", 34, "Atlanta", "Georgia"],
  ["US0755", "Ana Sani", "Ana", 34, "Toronto", "Ontario"],
  ["US0757", "Brady Booker", "Brady", 27, "Knoxville", "Tennessee"],
  ["US0758", "Carter Krull", "Carter", 24, "Sioux Falls", "South Dakota"],
  ["US0759", "Cristian Chavez", "Cristian", 26, "Salt Lake City", "Utah"],
  ["US0760", "Danny Kilby", "Danny", 30, "London", "Ontario"],
  ["US0761", "Devin Way", "Devin", 33, "Los Angeles", "California"],
  ["US0762", "Eric Macksoud", "Eric", 34, "Windsor Locks", "Connecticut"],
  ["US0756", "Angelica Loblack", "Jelly", 29, "Bloomington", "Indiana"],
  ["US0763", "Jenna Doore", "Jenna", 30, "Toledo", "Ohio"],
  [
    "US0764",
    "Kristin Flickinger",
    "Kristin",
    53,
    "Santa Barbara",
    "California",
  ],
  ["US0765", "Lewis Kelly", "Lewis", 28, null, "Puerto Rico"],
  ["US0766", "Linnea Capobianco", "Linnea", 25, "Jersey City", "New Jersey"],
  ["US0767", "Maggie Nestor", "Maggie", 40, "Charlestown", "West Virginia"],
  ["US0768", "Mike Pinsky", "Mike", 32, "New York City", "New York"],
  ["US0769", "Ori Jean-Charles", "Ori", 27, "Spring Valley", "New York"],
  ["US0770", "Patt Cannaday", "Patt", 33, "Washington", "District of Columbia"],
  ["US0771", "Rob Antonson", "Rob", 34, "Cumberland", "Rhode Island"],
  ["US0772", "Sharonda Cox", "Sharonda", 34, "Richmond", "Kentucky"],
  ["US0754", "Thien An Nguyen", "Thien An", 24, "Fort Worth", "Texas"],
];

const survivorCast = (rows = SURVIVOR_51_CASTAWAYS) =>
  transformPlayers(
    {
      castaways: rows.map(
        ([castaway_id, full_name, castaway, age, city, state]) =>
          ({
            version: "US",
            season: 51,
            castaway_id,
            full_name,
            castaway,
            age,
            city,
            state,
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
      episodeNum: 2,
      castawayId: "US0763",
      voteString: "5-3",
      variant: "tribal",
      finishText: "2nd voted out",
      order: 2,
    },
  ],
  events: [],
  voteHistory: [],
  warnings: [],
});

const format = async (content: string) =>
  prettier.format(content, {
    ...(await prettier.resolveConfig(SEASON_51_FILE)),
    filepath: SEASON_51_FILE,
  });

/** Everything before the first results export: header, imports and cast. */
const castBlock = (content: string) =>
  content.slice(0, content.indexOf("export const SEASON_51_EPISODES"));

const player = (overrides: Partial<MergedPlayer> = {}): MergedPlayer => ({
  castawayId: "US0001",
  fullName: "Pat Doe",
  castawayShortName: "Pat",
  img: "",
  ...overrides,
});

describe("regenerateSeasonFile on the committed Season 51 file", () => {
  // Hand edits to the cast keep this passing. If it fails after one, the
  // edit is probably a field out of the codegen's order (formatPlayerCall),
  // which the sync would reorder, or a field it cannot write.
  it("adds a new episode's results without touching a byte of the curated cast", async () => {
    const committed = fs.readFileSync(SEASON_51_FILE, "utf-8");

    const { content, keptDifferences } = regenerateSeasonFile(
      committed,
      survivorCast(),
      results(2),
      51,
    );
    const formatted = await format(content);

    expect(castBlock(formatted)).toBe(castBlock(committed));
    // The results are whatever survivoR says now, episode 1's included.
    expect(formatted).toContain('id: "episode_2"');
    expect(formatted).toMatch(
      /episode_id: "episode_2",[^}]*castaway_id: "US0763"/,
    );
    expect(formatted).toContain("SEASON_51_EVENTS = {} satisfies");
    // survivoR carries no professions, images or bios, so it can only
    // disagree on these (at 7336413: three ages and three hometowns).
    for (const note of keptDifferences) {
      expect(note).toMatch(
        /^US\d{4} .+: kept (age|hometown|castawayShortName|nickname) /,
      );
    }
  });

  it("reads every curated field of the committed cast", () => {
    const cast = readCommittedCast(
      fs.readFileSync(SEASON_51_FILE, "utf-8"),
      51,
    );

    expect(cast).toHaveLength(21);
    expect(cast.every((p) => p.profession && p.img && p.hometown)).toBe(true);
    expect(cast.find((p) => p.castawayId === "US0756")).toMatchObject({
      fullName: "Angelica Loblack",
      castawayShortName: "Jelly",
      nickname: "Jelly",
      img: "/images/season_51/Jelly-Loblack.jpg",
    });
  });
});

describe("regenerateSeasonFile", () => {
  it("builds the cast from survivoR alone when there is no committed file", () => {
    const { content } = regenerateSeasonFile(
      undefined,
      survivorCast(),
      results(1),
      51,
    );

    expect(content.startsWith("import {")).toBe(true);
    expect(content).toContain("age: 53,");
    expect(content).not.toContain("profession:");
  });
});

describe("readCommittedCast", () => {
  const file = (players: string, lookup = "") => `
const IMG = "/images/season_52";

export const SEASON_52_CASTAWAY_LOOKUP: CastawayLookup = {
${lookup}
};

export const SEASON_52_PLAYERS = [
${players}
] satisfies Player<CastawayIdType, SeasonNumber>[];
`;

  it("reads literals, IMG templates, number arrays and the lookup short name", () => {
    const cast = readCommittedCast(
      file(
        `  buildPlayer({
    castaway_id: "US0800",
    full_name: 'Jo "JJ" Smith',
    img: \`\${IMG}/Jo-Smith.jpg\`,
    age: 41,
    previousSeasons: [40, 45],
    gender: "Female",
    bio: "Returns for a third time.",
  }),`,
        `  US0800: { full_name: 'Jo "JJ" Smith', castaway: "JJ" },`,
      ),
      52,
    );

    expect(cast).toEqual([
      {
        castawayId: "US0800",
        fullName: 'Jo "JJ" Smith',
        castawayShortName: "JJ",
        img: "/images/season_52/Jo-Smith.jpg",
        age: 41,
        previousSeasons: [40, 45],
        gender: "Female",
        bio: "Returns for a third time.",
      },
    ]);
  });

  it("refuses a field it would drop instead of losing it", () => {
    expect(() =>
      readCommittedCast(
        file(`  buildPlayer({
    castaway_id: "US0800",
    full_name: "Jo Smith",
    img: "",
    tribe: "Luvu",
  }),`),
        52,
      ),
    ).toThrow(/tribe: "Luvu".*would drop/);
  });

  it("refuses a value that is not a plain literal", () => {
    expect(() =>
      readCommittedCast(
        file(`  buildPlayer({
    castaway_id: "US0800",
    full_name: "Jo Smith",
    img: "",
    age: AGES.jo,
  }),`),
        52,
      ),
    ).toThrow(/PLAYERS\[0\]\.age is not a plain literal/);
  });

  it("refuses a cast it cannot read at all", () => {
    expect(() =>
      readCommittedCast(
        file(`  buildPlayer("Jo Smith", "/images/jo.jpg"),`),
        52,
      ),
    ).toThrow(/not buildPlayer\(\{ \.\.\. \}\)/);
    expect(() => readCommittedCast("export const X = 1;", 52)).toThrow(
      /SEASON_52_PLAYERS is not an array literal/,
    );
  });
});

describe("keepCuratedCast", () => {
  it("keeps committed values, fills only blanks and reports disagreements", () => {
    const committed = player({
      castawayShortName: "Patty",
      img: "/images/pat.jpg",
      age: 30,
      profession: "Chef",
      hometown: "",
    });
    const fromSource = player({
      age: 31,
      hometown: "Austin, Texas",
      nickname: "Patty",
    });

    const { cast, keptDifferences } = keepCuratedCast(
      [fromSource],
      [committed],
    );

    expect(cast).toEqual([
      player({
        castawayShortName: "Patty",
        img: "/images/pat.jpg",
        age: 30,
        profession: "Chef",
        hometown: "Austin, Texas",
        nickname: "Patty",
      }),
    ]);
    expect(keptDifferences).toEqual([
      'US0001 Pat Doe: kept castawayShortName "Patty"; survivoR has "Pat"',
      "US0001 Pat Doe: kept age 30; survivoR has 31",
    ]);
  });

  it("takes a renamed full_name from survivoR but keeps the curated fields", () => {
    const { cast } = keepCuratedCast(
      [player({ fullName: "Patricia Doe" })],
      [player({ profession: "Chef" })],
    );

    expect(cast).toEqual([
      player({ fullName: "Patricia Doe", profession: "Chef" }),
    ]);
  });

  it("keeps the committed order and appends castaways survivoR adds", () => {
    const { cast } = keepCuratedCast(
      [
        player({ castawayId: "US0003", fullName: "New Castaway" }),
        player({ castawayId: "US0002" }),
        player({ castawayId: "US0001" }),
      ],
      [player({ castawayId: "US0001" }), player({ castawayId: "US0002" })],
    );

    expect(cast.map((p) => p.castawayId)).toEqual([
      "US0001",
      "US0002",
      "US0003",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildProvisionalCastaways,
  nextCastawayId,
  parseWikiCastTable,
  splitHometown,
} from "../wiki-cast";

const SEASON_PAGE = `{{Season
| season = 51
}}
'''''Survivor 51''''' is the upcoming season.

==Castaways==
{| class="wikitable sortable"
! colspan="2" rowspan="2"| Contestant
|-
! Original Tribe
|-
| {{tribebox2|}}[[File:S51 aaliyah t.png|70px|link=Aaliyah Puglia]]
| align="left"| '''[[Aaliyah Puglia]]'''<br /><small>24, Providence, RI<br />Chef</small>
|
| Active
|-
| {{tribebox2|}}[[File:S51 kilby t.png|70px|link=Danny Kilby]]
| align="left"| {{nowrap|'''[[Danny Kilby]]'''}}<br /><small>30, London, ON<br />Game Designer</small>
|
| Active
|-
| {{tribebox2|}}[[File:S51 mc t.png|70px|link=MC Example]]
| align="left"| '''[[MC Example (Survivor)|MC Example]]'''<br /><small>29, Washington, DC<ref>cbs</ref><br />Prosecutor</small>
|
| Active
|}

==Season Summary==
{{S51epguide}}
`;

describe("parseWikiCastTable", () => {
  it("reads name, age, hometown and occupation from each row", () => {
    const cast = parseWikiCastTable(SEASON_PAGE);
    expect(cast).toEqual([
      {
        fullName: "Aaliyah Puglia",
        age: 24,
        hometown: "Providence, RI",
        occupation: "Chef",
      },
      {
        fullName: "Danny Kilby",
        age: 30,
        hometown: "London, ON",
        occupation: "Game Designer",
      },
      {
        fullName: "MC Example",
        age: 29,
        hometown: "Washington, DC",
        occupation: "Prosecutor",
      },
    ]);
  });

  it("returns nothing when the page has no Castaways section", () => {
    expect(parseWikiCastTable("{{Season\n| season = 99\n}}")).toEqual([]);
  });
});

describe("splitHometown", () => {
  it("expands US state and Canadian province abbreviations", () => {
    expect(splitHometown("Providence, RI")).toEqual({
      city: "Providence",
      state: "Rhode Island",
    });
    expect(splitHometown("London, ON")).toEqual({
      city: "London",
      state: "Ontario",
    });
    expect(splitHometown("Washington, DC")).toEqual({
      city: "Washington",
      state: "D.C.",
    });
  });

  it("passes unknown regions and single tokens through", () => {
    expect(splitHometown("Corozal, XX")).toEqual({
      city: "Corozal",
      state: "XX",
    });
    expect(splitHometown("Paris")).toEqual({ city: "Paris", state: null });
  });
});

describe("nextCastawayId", () => {
  it("is one past the highest existing US id", () => {
    expect(nextCastawayId(["US0001", "US0751", "US0300"])).toBe("US0752");
  });
});

describe("buildProvisionalCastaways", () => {
  const cast = [
    { fullName: "Matt Williams", age: 30, hometown: "Austin, TX" },
    { fullName: "MC Chukwujekwu", age: 28, hometown: "Chicago, IL" },
    { fullName: "alex Moore" },
    { fullName: "Returning Star", age: 40 },
  ];

  it("numbers new castaways alphabetically by full_name, case-insensitive", () => {
    const rows = buildProvisionalCastaways(cast, 51, "US0752");
    expect(rows.map((r) => [r.castaway_id, r.full_name])).toEqual([
      ["US0752", "alex Moore"],
      ["US0753", "Matt Williams"],
      ["US0754", "MC Chukwujekwu"],
      ["US0755", "Returning Star"],
    ]);
  });

  it("keeps a returning player's real id without consuming a new one", () => {
    const known = new Map([["Returning Star", "US0123"]]);
    const rows = buildProvisionalCastaways(cast, 51, "US0752", known);
    expect(rows.map((r) => [r.castaway_id, r.full_name])).toEqual([
      ["US0752", "alex Moore"],
      ["US0753", "Matt Williams"],
      ["US0754", "MC Chukwujekwu"],
      ["US0123", "Returning Star"],
    ]);
  });

  it("shapes rows like survivoR castaways with expanded hometowns", () => {
    const [alex, matt] = buildProvisionalCastaways(cast, 51, "US0752");
    expect(alex).toMatchObject({
      version: "US",
      version_season: "US51",
      season: 51,
      castaway: "alex",
      age: null,
      city: null,
      state: null,
      winner: false,
    });
    expect(matt).toMatchObject({
      castaway: "Matt",
      age: 30,
      city: "Austin",
      state: "Texas",
    });
  });

  it("rejects a malformed first id", () => {
    expect(() => buildProvisionalCastaways(cast, 51, "752")).toThrow(
      /Invalid first castaway id/,
    );
  });
});

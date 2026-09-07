import { describe, expect, it } from "vitest";
import {
  parseBirthDate,
  parseContestantPage,
  parseInfoboxFields,
  parseNickname,
  parseSeasonInfobox,
  parseSeasonNumber,
} from "../wikitext-parser";

// Real wikitext samples from the Survivor Wiki

const BEN_KATZMAN_WIKITEXT = `{{Contestant
| image        = S46 Ben Katzman.jpg
| birthdate    = {{Birth date and age|1992|3|25|mf=yes}}
| hometown     = Miami, Florida
| occupation   = Musician
| socialmedia  = {{Socmed|ig=bkdegreaser69|x=bkdegreaser69}}
| version      = {{version|us}}
| season       = {{S2|46}}
| tribes       = {{tribeicon|siga}}<br />{{tribeicon|nuinui}}
| place        = Second Runner-Up (3/18)
| alliances    = [[Siga Alliance]]<br />{{Dab|Final Four Alliance|46}}
| challenges   = 6
| votesagainst = 4
| days         = 26/26
}}`;

const TONY_VLACHOS_WIKITEXT = `{{Contestant
| image         = <tabber>Australia v The World (AU)=[[File:AUS13 Tony Vlachos.jpg]]|-|Winners at War=[[File:S40 Tony Vlachos.jpg]]|-|Game Changers=[[File:S34 Tony Vlachos.jpg]]|-|Cagayan=[[File:S28 Tony Vlachos.jpg]]</tabber>
| birthdate     = {{Birth date and age|1973|9|10|mf=y}}
| hometown      = Jersey City, New Jersey;<br />Allendale, New Jersey
| occupation    = Police Officer
| version       = {{Version|us}}<br />{{Version|au}}
| season        = {{S2|28}}
| place         = Winner
| season2       = {{S2|34}}
| place2        = 19/20
| season3       = {{S2|40}}
| place3        = Winner
| season4       = {{S2|13au}} (AU)
| place4        = 11/14
}}

'''Anthony "Tony" Vlachos''' is the [[Sole Survivor]] of {{S|28}} and {{S|40}}.`;

const COLBY_DONALDSON_WIKITEXT = `{{Spoiler}}{{Contestant
| image         = <tabber>In the Hands of the Fans=[[File:S50 Colby Donaldson.jpg]]</tabber>
| birthdate     = {{Birth date and age|1974|4|1|mf=yes}}
| hometown      = Dallas, Texas;<br />Los Angeles, California;<br />Austin, Texas
| occupation    = Auto Customizer;<br />Rancher
| socialmedia   = {{socmed|ig=colby_donaldson}}
| version       = {{Version|us}}
| season        = {{S2|2}}
| tribes        = {{tribeicon|ogakor}}<br />{{tribeicon|barramundi}}
| place         = Runner-Up (2/16)
| alliances     = [[Ogakor Alliance]]
| challenges    = 12
| votesagainst  = 9
| days          = 42/42
| season2       = {{S2|8}}
| tribes2       = {{tribeicon|mogomogo}}
| place2        = 12/18
| alliances2    =
| challenges2   = 6
| votesagainst2 = 4
| days2         = 19/39
| season3       = {{S2|20}}
| tribes3       = {{tribeicon|heroes}}<br />{{tribeicon|yinyang}}
| place3        = 5/20
| alliances3    = [[Heroes Alliance]] ''(affiliated)''
| challenges3   = 8
| votesagainst3 = 7
| days3         = 37/39
| season4       = {{S2|50}}
| tribes4       = {{tribeicon|vatu}}<br/>{{tribeicon4|kalo}}
| place4        =
| alliances4    =
| challenges4   = 6
| votesagainst4 =
| days4         =
}}`;

const CHRIS_DAUGHERTY_WIKITEXT = `{{Contestant
| image        = S9 Chris Daugherty.jpg
| birthdate    = {{Birth date and age|1970|8|29|mf=yes}}
| hometown     = South Vienna, Ohio
| occupation   = Highway Construction Worker
| version      = {{Version|us}}
| season       = {{S2|9}}
| tribes       = {{tribeicon|lopevi}}<br />{{tribeicon|alinta}}
| place        = Winner
| alliances    = [[Fat Five]]<br />{{dab|Final Four Alliance|Vanuatu}}
| challenges   = 12
| votesagainst = 3
| days         = 39/39
}}`;

describe("parseBirthDate", () => {
  it("parses a standard birthdate template", () => {
    const result = parseBirthDate("{{Birth date and age|1992|3|25|mf=yes}}");
    expect(result).toEqual(
      expect.objectContaining({ year: 1992, month: 3, day: 25 }),
    );
    expect(result!.age).toBeGreaterThanOrEqual(33);
  });

  it("handles single-digit month and day", () => {
    const result = parseBirthDate("{{Birth date and age|1974|4|1|mf=yes}}");
    expect(result).toEqual(
      expect.objectContaining({ year: 1974, month: 4, day: 1 }),
    );
  });

  it("returns null for non-matching input", () => {
    expect(parseBirthDate("some random text")).toBeNull();
  });
});

describe("parseSeasonNumber", () => {
  it("parses {{S2|46}}", () => {
    expect(parseSeasonNumber("{{S2|46}}")).toBe(46);
  });

  it("parses {{S2|9}}", () => {
    expect(parseSeasonNumber("{{S2|9}}")).toBe(9);
  });

  it("returns null for empty string", () => {
    expect(parseSeasonNumber("")).toBeNull();
  });
});

describe("parseNickname", () => {
  it("extracts Q from bold intro", () => {
    expect(
      parseNickname(
        `'''Quintavius "Q" Burdette''' is a contestant from {{S|46}}.`,
      ),
    ).toBe("Q");
  });

  it("extracts Coach from bold intro", () => {
    expect(
      parseNickname(
        `'''Benjamin "Coach" Wade''' is a contestant from {{S|18}}.`,
      ),
    ).toBe("Coach");
  });

  it("extracts Ozzy from bold intro", () => {
    expect(
      parseNickname(`'''Oscar "Ozzy" Lusth''' is a contestant from {{S|13}}.`),
    ).toBe("Ozzy");
  });

  it("returns null when no nickname present", () => {
    expect(
      parseNickname(`'''Sandra Diaz-Twine''' is the Sole Survivor of {{S|7}}.`),
    ).toBeNull();
  });

  it("prefers 'also known as' alias over inline quoted name", () => {
    expect(
      parseNickname(
        `'''Robert Carlo "Rob" Mariano''' (also known as '''Boston Rob''') is a contestant.`,
      ),
    ).toBe("Boston Rob");
  });

  it("returns null when no bold intro block", () => {
    expect(
      parseNickname("some random text without bold formatting"),
    ).toBeNull();
  });

  it("handles smart/curly quotes", () => {
    expect(
      parseNickname(`'''Benjamin \u201CCoach\u201D Wade''' is a contestant.`),
    ).toBe("Coach");
  });
});

describe("parseInfoboxFields", () => {
  it("extracts all fields from a single-season player", () => {
    const fields = parseInfoboxFields(BEN_KATZMAN_WIKITEXT);
    expect(fields).toEqual(
      expect.objectContaining({
        hometown: "Miami, Florida",
        occupation: "Musician",
        place: "Second Runner-Up (3/18)",
        days: "26/26",
      }),
    );
  });

  it("extracts numbered fields from returning player", () => {
    const fields = parseInfoboxFields(COLBY_DONALDSON_WIKITEXT);
    expect(fields).not.toBeNull();
    expect(fields!.season).toContain("2");
    expect(fields!.season2).toContain("8");
    expect(fields!.season3).toContain("20");
    expect(fields!.season4).toContain("50");
    expect(fields!.tribes2).toContain("mogomogo");
  });

  it("returns null when no Contestant template found", () => {
    expect(
      parseInfoboxFields("some random text without a template"),
    ).toBeNull();
  });
});

describe("parseContestantPage", () => {
  it("parses a Season 46 contestant (Ben Katzman)", () => {
    const info = parseContestantPage(BEN_KATZMAN_WIKITEXT, 46);
    expect(info).toEqual(
      expect.objectContaining({
        hometown: "Miami, Florida",
        occupation: "Musician",
        previousSeasons: [],
        allSeasons: [46],
      }),
    );
    expect(info!.age).toBeGreaterThanOrEqual(33);
    expect(info!.nickname).toBeUndefined();
  });

  it("parses a Season 9 contestant (Chris Daugherty)", () => {
    const info = parseContestantPage(CHRIS_DAUGHERTY_WIKITEXT, 9);
    expect(info).toEqual(
      expect.objectContaining({
        hometown: "South Vienna, Ohio",
        occupation: "Highway Construction Worker",
        previousSeasons: [],
      }),
    );
  });

  it("parses a returning player with 4 seasons (Colby Donaldson for S50)", () => {
    const info = parseContestantPage(COLBY_DONALDSON_WIKITEXT, 50);
    expect(info).toEqual(
      expect.objectContaining({
        hometown: "Dallas, Texas",
        occupation: "Auto Customizer",
        allSeasons: [2, 8, 20, 50],
        previousSeasons: [2, 8, 20],
      }),
    );
  });

  it("parses a returning player for their first season (Colby for S2)", () => {
    const info = parseContestantPage(COLBY_DONALDSON_WIKITEXT, 2);
    expect(info).toEqual(expect.objectContaining({ previousSeasons: [] }));
  });

  it("picks the target season's tab from a multi-season tabber image", () => {
    expect(parseContestantPage(TONY_VLACHOS_WIKITEXT, 28)).toEqual(
      expect.objectContaining({
        imageFileName: "S28 Tony Vlachos.jpg",
        imageIsSeasonSpecific: true,
      }),
    );
    expect(parseContestantPage(TONY_VLACHOS_WIKITEXT, 34)).toEqual(
      expect.objectContaining({
        imageFileName: "S34 Tony Vlachos.jpg",
        imageIsSeasonSpecific: true,
      }),
    );
    expect(parseContestantPage(TONY_VLACHOS_WIKITEXT, 40)).toEqual(
      expect.objectContaining({
        imageFileName: "S40 Tony Vlachos.jpg",
        imageIsSeasonSpecific: true,
      }),
    );
  });

  it("accepts the Image: namespace alias inside a tabber", () => {
    const wikitext = `{{Contestant
| image         = <tabber>Blood vs. Water=[[File:S27 Gervase Peterson.jpg]]|-|Borneo=[[Image:S1 Gervase Peterson.jpg]]</tabber>
| season        = {{S2|1}}
| season2       = {{S2|27}}
}}`;
    expect(parseContestantPage(wikitext, 1)).toEqual(
      expect.objectContaining({
        imageFileName: "S1 Gervase Peterson.jpg",
        imageIsSeasonSpecific: true,
      }),
    );
  });

  it("does not let S2 match the S28 tab", () => {
    expect(parseContestantPage(TONY_VLACHOS_WIKITEXT, 2)).toEqual(
      expect.objectContaining({
        imageFileName: "AUS13 Tony Vlachos.jpg",
        imageIsSeasonSpecific: false,
      }),
    );
  });

  it("falls back to the first tab when the target season has no image", () => {
    const info = parseContestantPage(COLBY_DONALDSON_WIKITEXT, 2);
    expect(info?.imageFileName).toBe("S50 Colby Donaldson.jpg");
    expect(info?.imageIsSeasonSpecific).toBe(false);
  });

  it("flags a single-season plain image as season-specific for its own season", () => {
    expect(parseContestantPage(BEN_KATZMAN_WIKITEXT, 46)).toEqual(
      expect.objectContaining({
        imageFileName: "S46 Ben Katzman.jpg",
        imageIsSeasonSpecific: true,
      }),
    );
  });

  it("returns null for wikitext without Contestant template", () => {
    expect(parseContestantPage("no template here")).toBeNull();
  });

  it("extracts nickname when bold intro precedes infobox", () => {
    const wikitext = `'''Benjamin "Coach" Wade''' is a contestant from {{S|18}}.

${COLBY_DONALDSON_WIKITEXT.replace("{{Spoiler}}", "")}`;
    const info = parseContestantPage(wikitext, 50);
    expect(info).toEqual(expect.objectContaining({ nickname: "Coach" }));
  });
});

// Real wikitext samples from season pages

const SEASON_50_INFOBOX = `{{Season
| image           = <center><tabber>Updated=[[File:In the Hands of the Fans Logo.png|center|200px]]</tabber></center>
| version           = {{version|us}}
| location          = {{wp|Mamanuca Islands}}, {{wp|Fiji}}
| filmingdates      = June 5, 2025 - June 30, 2025<ref>https://example.com</ref>
| seasonrun         = February 25, 2026<ref>https://example.com</ref> - May 20, 2026<ref>https://example.com</ref>
| episodes          =
| season            = 50
| days              = 26
| survivors         = 24
| winner            =
| runnerup          =
| tribes            = {{tribeicon|cila}}
| previous          = {{S2|49}}
| next              =
}}`;

const SEASON_1_INFOBOX = `{{Season
| image        = <center><tabber>Updated=[[File:Borneo.png|center|200px]]</tabber></center>
| version      = {{version|us}}
| season       = 1
| location     = {{wp|Tiga Island, Malaysia|Pulau Tiga}}, {{wp|Sabah}}, {{wp|Borneo}}, {{wp|Malaysia}}
| filmingdates = March 13, 2000 - April 20, 2000
| seasonrun    = May 31, 2000 - August 23, 2000
| episodes     = 14
| days         = 39
| survivors    = 16
| winner       = [[Richard Hatch]]
| tribes       = {{tribeicon|pagong}}
| next         = {{S2|2}}
}}`;

describe("parseSeasonInfobox", () => {
  it("extracts location, filming dates, and season run from S50", () => {
    const info = parseSeasonInfobox(SEASON_50_INFOBOX);
    expect(info).toEqual(
      expect.objectContaining({
        location: "Mamanuca Islands, Fiji",
        filmingDates: "June 5, 2025 - June 30, 2025",
        seasonRun: "February 25, 2026 - May 20, 2026",
      }),
    );
  });

  it("extracts location with multiple wiki links and filming dates from S1", () => {
    const info = parseSeasonInfobox(SEASON_1_INFOBOX);
    expect(info).toEqual(
      expect.objectContaining({
        location: "Pulau Tiga, Sabah, Borneo, Malaysia",
        filmingDates: "March 13, 2000 - April 20, 2000",
      }),
    );
  });

  it("returns null for wikitext without Season template", () => {
    expect(parseSeasonInfobox("no template here")).toBeNull();
  });

  it("returns undefined fields for missing location/dates", () => {
    const info = parseSeasonInfobox(`{{Season
| version = {{version|us}}
| season  = 99
}}`);
    expect(info).not.toBeNull();
    expect(info!.location).toBeUndefined();
    expect(info!.filmingDates).toBeUndefined();
    expect(info!.seasonRun).toBeUndefined();
  });
});

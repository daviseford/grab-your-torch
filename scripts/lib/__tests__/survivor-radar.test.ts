import { describe, expect, it } from "vitest";
import {
  MAX_ISSUE_BODY_LENGTH,
  canonicalize,
  decide,
  diffTables,
  fingerprintTable,
  parseIssueBody,
  renderBody,
  renderIssueBody,
  renderSubject,
  type RadarState,
} from "../survivor-radar";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

const episodes = [
  { version: "US", season: 51.0, episode: 1.0, episode_title: "One" },
  { version: "US", season: 50.0, episode: 1.0, episode_title: "Old" },
  { version: "AU", season: 11.0, episode: 1.0, episode_title: "Aussie" },
];

const state = (
  tables: RadarState["tables"],
  commit = COMMIT_A,
): RadarState => ({
  version: 1,
  scope: "US",
  commit,
  observedAt: "2026-10-01T14:00:00.000Z",
  tables,
});

describe("fingerprintTable", () => {
  it("groups US rows by season and ignores other franchises", () => {
    const groups = fingerprintTable("episodes", episodes);
    expect(Object.keys(groups)).toEqual(["50", "51"]);
    expect(groups["51"].rows).toBe(1);
  });

  it("ignores row order, key order, float-encoded integers and nulls", () => {
    const base = fingerprintTable("episodes", episodes);
    const reshaped = fingerprintTable("episodes", [
      { episode_title: "Old", episode: 1, season: 50, version: "US" },
      {
        season: 51,
        episode: 1,
        episode_title: "One",
        version: "US",
        note: null,
      },
    ]);
    expect(reshaped).toEqual(base);
  });

  it("changes the digest when any in-scope value changes", () => {
    const base = fingerprintTable("episodes", episodes);
    const corrected = fingerprintTable("episodes", [
      { ...episodes[0] },
      { ...episodes[1], episode_title: "Old (corrected)" },
    ]);
    expect(corrected["51"]).toEqual(base["51"]);
    expect(corrected["50"].digest).not.toBe(base["50"].digest);
    expect(corrected["50"].rows).toBe(base["50"].rows);
  });

  it("does not move when only another franchise changes", () => {
    const base = fingerprintTable("episodes", episodes);
    const auOnly = fingerprintTable("episodes", [
      episodes[0],
      episodes[1],
      { ...episodes[2], episode_title: "Aussie (corrected)" },
      { version: "NZ", season: 3, episode: 1 },
    ]);
    expect(auOnly).toEqual(base);
  });

  it("puts version-less rows in an all-seasons group, US castaways only", () => {
    const groups = fingerprintTable("castaway_details", [
      { castaway_id: "US0001", full_name: "A" },
      { castaway_id: "AU0001", full_name: "B" },
    ]);
    expect(groups).toEqual({ all: expect.objectContaining({ rows: 1 }) });
  });

  it("keeps duplicate rows distinct", () => {
    const once = fingerprintTable("t", [episodes[0]]);
    const twice = fingerprintTable("t", [episodes[0], episodes[0]]);
    expect(twice["51"].digest).not.toBe(once["51"].digest);
  });

  it("rejects a table that is not an array of objects", () => {
    expect(() => fingerprintTable("t", { rows: [] })).toThrow(
      /not a JSON array/,
    );
    expect(() => fingerprintTable("t", [1])).toThrow(/not an object/);
  });
});

describe("canonicalize", () => {
  it("sorts nested keys and keeps array order", () => {
    expect(canonicalize({ b: [2, 1], a: { d: 1, c: null } })).toBe(
      '{"a":{"d":1},"b":[2,1]}',
    );
  });
});

describe("decide", () => {
  const before = state({ episodes: fingerprintTable("episodes", episodes) });

  it("records a baseline without alerting when there is no previous state", () => {
    const decision = decide(null, before);
    expect(decision.action).toBe("baseline");
    expect(decision.changes).toEqual([]);
  });

  it("stays quiet when only the upstream commit moved", () => {
    const after = { ...before, commit: COMMIT_B };
    expect(decide(before, after).action).toBe("unchanged");
  });

  it("alerts on a new episode, a historical correction, and a new table", () => {
    const after = state(
      {
        episodes: fingerprintTable("episodes", [
          episodes[0],
          { ...episodes[0], episode: 2, episode_title: "Two" },
          { ...episodes[1], episode_title: "Old (corrected)" },
        ]),
        journeys: fingerprintTable("journeys", [
          { version: "US", season: 51, castaway_id: "US0001" },
        ]),
      },
      COMMIT_B,
    );
    const decision = decide(before, after);
    expect(decision.action).toBe("alert");
    expect(decision.changes).toEqual([
      {
        table: "episodes",
        group: "50",
        kind: "changed",
        previousRows: 1,
        rows: 1,
      },
      {
        table: "episodes",
        group: "51",
        kind: "changed",
        previousRows: 1,
        rows: 2,
      },
      {
        table: "journeys",
        group: "51",
        kind: "added",
        previousRows: null,
        rows: 1,
      },
    ]);
  });

  it("alerts when a season's records disappear", () => {
    const after = state({
      episodes: fingerprintTable("episodes", [episodes[0]]),
    });
    expect(decide(before, after).changes).toEqual([
      {
        table: "episodes",
        group: "50",
        kind: "removed",
        previousRows: 1,
        rows: null,
      },
    ]);
  });
});

describe("diffTables", () => {
  it("is empty for identical observations", () => {
    const tables = { episodes: fingerprintTable("episodes", episodes) };
    expect(diffTables(tables, tables)).toEqual([]);
  });
});

describe("email rendering", () => {
  const decision = decide(
    state({ episodes: fingerprintTable("episodes", episodes) }),
    state(
      {
        episodes: fingerprintTable("episodes", [
          episodes[0],
          { ...episodes[0], episode: 2 },
          { ...episodes[1], episode_title: "Fixed" },
        ]),
      },
      COMMIT_B,
    ),
  );

  it("names the seasons in the subject, newest first", () => {
    expect(renderSubject(decision)).toBe(
      "survivoR Radar: survivoR data changed (Season 51, Season 50)",
    );
  });

  it("lists each change and links the upstream diff", () => {
    const body = renderBody(decision, { runUrl: "https://run" });
    expect(body).toContain("## Season 51");
    expect(body).toContain("- `episodes`: 1 row to 2 rows");
    expect(body).toContain("- `episodes`: values edited, still 1 row");
    expect(body).toContain(
      `https://github.com/doehm/survivoR/compare/${COMMIT_A}...${COMMIT_B}`,
    );
    expect(body).toContain("- Workflow run: https://run");
    expect(body).not.toContain("—");
  });
});

describe("issue state block", () => {
  const original = state({
    episodes: fingerprintTable("episodes", episodes),
    castaway_details: fingerprintTable("castaway_details", [
      { castaway_id: "US0001" },
    ]),
  });

  it("round-trips through the issue body", () => {
    expect(parseIssueBody(renderIssueBody(original))).toEqual(original);
  });

  it("returns null for a missing block or another radar version", () => {
    expect(parseIssueBody(null)).toBeNull();
    expect(parseIssueBody("hand-written notes")).toBeNull();
    const otherVersion = renderIssueBody(original).replace(
      '"version":1',
      '"version":2',
    );
    expect(parseIssueBody(otherVersion)).toBeNull();
  });

  it("fails loudly on a corrupted block instead of re-baselining", () => {
    const corrupted = renderIssueBody(original).replace(
      /"[0-9a-f]{16}:/,
      '"zz:',
    );
    expect(() => parseIssueBody(corrupted)).toThrow();
    const injected = renderIssueBody(original).replace(
      '"episodes"',
      '"episodes --><script>"',
    );
    expect(() => parseIssueBody(injected)).toThrow(/invalid table name/);
  });

  it("fits a full-size dataset in the issue body budget", () => {
    // 30 tables x 60 seasons is beyond today's 23 x 51.
    const tables: RadarState["tables"] = {};
    for (let t = 0; t < 30; t++) {
      tables[`table_number_${t}`] = Object.fromEntries(
        Array.from({ length: 60 }, (_, s) => [
          String(s + 1),
          { digest: "0123456789abcdef", rows: 12345 },
        ]),
      );
    }
    expect(renderIssueBody(state(tables)).length).toBeLessThan(
      MAX_ISSUE_BODY_LENGTH,
    );
  });
});

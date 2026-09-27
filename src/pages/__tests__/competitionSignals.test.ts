import { describe, expect, it } from "vitest";
import {
  competitionBugContext,
  competitionContextLine,
  competitionEpisodeLabel,
  competitionEpisodeSortKey,
  competitionModeBadge,
} from "../competitionSignals";

const live = { season_num: 50, current_episode: null, finished: false };
const liveDone = { season_num: 50, current_episode: null, finished: true };
const fresh = { season_num: 47, current_episode: 0, finished: false };
const midway = { season_num: 47, current_episode: 6, finished: false };
const watchedOut = { season_num: 47, current_episode: 13, finished: true };

describe("competitionBugContext", () => {
  it("names the mode and the revealed episode", () => {
    expect(competitionBugContext(live)).toBe("S50 · Live");
    expect(competitionBugContext(fresh)).toBe("S47 · Watch-along");
    expect(competitionBugContext(midway)).toBe("S47 · Ep 6 · Watch-along");
  });

  it("calls a finished live competition complete, not live", () => {
    expect(competitionBugContext(liveDone)).toBe("S50 · Complete");
    expect(competitionBugContext(watchedOut)).toBe("S47 · Ep 13 · Watch-along");
  });
});

describe("competitionModeBadge", () => {
  it("shows live only while a live competition is running", () => {
    expect(competitionModeBadge(live)).toBe("live");
    expect(competitionModeBadge(liveDone)).toBeNull();
  });

  it("always shows watch-along, finished or not", () => {
    expect(competitionModeBadge(fresh)).toBe("watch-along");
    expect(competitionModeBadge(watchedOut)).toBe("watch-along");
  });
});

describe("competitionContextLine", () => {
  it("carries the cyan context only while the competition runs", () => {
    expect(competitionContextLine(live)).toBe("Season 50 · Live");
    expect(competitionContextLine(midway)).toBe("Season 47 · Watch-along");
    expect(competitionContextLine(liveDone)).toBeUndefined();
    expect(competitionContextLine(watchedOut)).toBe("Season 47 · Watch-along");
  });
});

describe("competitionEpisodeLabel", () => {
  it("calls a watch-along group that has not watched episode 1 pre-season", () => {
    expect(competitionEpisodeLabel(fresh)).toBe("Pre-season");
  });

  it("names the group's own episode boundary once it has advanced", () => {
    expect(competitionEpisodeLabel(midway)).toBe("Episode 6");
    expect(competitionEpisodeLabel(watchedOut)).toBe("Episode 13");
  });

  it("gives a live competition no episode, running or finished", () => {
    expect(competitionEpisodeLabel(live)).toBeNull();
    expect(competitionEpisodeLabel(liveDone)).toBeNull();
    expect(
      competitionEpisodeLabel({ current_episode: undefined as never }),
    ).toBeNull();
  });
});

describe("competitionEpisodeSortKey", () => {
  it("orders by episode watched, pre-season ahead of live", () => {
    const sorted = [live, midway, fresh, watchedOut, liveDone]
      .slice()
      .sort(
        (a, b) => competitionEpisodeSortKey(b) - competitionEpisodeSortKey(a),
      )
      .map(competitionEpisodeLabel);
    expect(sorted).toEqual([
      "Episode 13",
      "Episode 6",
      "Pre-season",
      null,
      null,
    ]);
  });
});

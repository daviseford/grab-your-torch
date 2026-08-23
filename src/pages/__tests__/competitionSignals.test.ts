import { describe, expect, it } from "vitest";
import {
  competitionBugContext,
  competitionContextLine,
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

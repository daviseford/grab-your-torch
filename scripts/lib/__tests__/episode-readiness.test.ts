import fs from "fs";
import { describe, expect, it } from "vitest";
import {
  assessEpisodeReadiness,
  assessNewEpisodes,
  heldReasons,
} from "../episode-readiness";
import type { SurvivorSeasonData } from "../survivor-client";

/*
 * Fixtures are real survivoR rows, trimmed to one season, at these upstream
 * commits:
 * - c0f2511 (2026-10-15): US51 Episode 4 with every scoring row;
 *   challenge_description covers only Episodes 1 and 2.
 * - 2b8c3a3 (2026-10-09): US51 Episode 3 with every scoring row but no
 *   challenge_description row.
 * - 7336413 (2026-09-26): US51 Episode 1 complete, the state the app imported.
 * - d4a75af (45 minutes earlier): US51 added without challenge_description.
 * - ba77948 (2026-05-03): US50 Episode 10 with its challenge rows missing,
 *   and Episode 11 only in tribe_mapping. Rows before Episode 9 are trimmed.
 * - 403f4a4 (2026-04-23): US50 Episode 9 complete, tribe_mapping already at
 *   Episode 10. Rows before Episode 8 are trimmed.
 */
/**
 * The gate no longer reads challenge descriptions, but the fixtures keep
 * survivoR's rows so the tests prove they cannot hold an episode.
 */
type ReadinessData = SurvivorSeasonData & {
  challengeDescription: { episode: number; challenge_id: number }[];
};

function load(name: string): ReadinessData {
  const raw = JSON.parse(
    fs.readFileSync(
      new URL(`./fixtures/survivor-${name}.json`, import.meta.url),
      "utf8",
    ),
  );
  const t = raw.tables;
  return {
    castaways: t.castaways,
    episodes: t.episodes,
    challengeResults: t.challenge_results,
    challengeDescription: t.challenge_description,
    voteHistory: t.vote_history,
    advantageDetails: t.advantage_details,
    advantageMovement: t.advantage_movement,
    tribeMapping: t.tribe_mapping,
    journeys: t.journeys,
  };
}

const clone = (data: ReadinessData): ReadinessData =>
  structuredClone(data) as ReadinessData;

describe("assessEpisodeReadiness on real survivoR snapshots", () => {
  it("accepts US51 Episode 1 as survivoR finished it", () => {
    const r = assessEpisodeReadiness(load("us51-7336413"), 51, 1);
    expect(r.missing).toEqual([]);
    expect(r.status).toBe("complete");
  });

  it("accepts US51 Episode 1 before challenge_description landed", () => {
    const data = load("us51-d4a75af");
    expect(data.challengeDescription).toEqual([]);
    const r = assessEpisodeReadiness(data, 51, 1);
    expect(r.missing).toEqual([]);
    expect(r.status).toBe("complete");
  });

  it("holds US50 Episode 10 while its challenge results were missing", () => {
    const data = load("us50-ba77948");
    const r = assessEpisodeReadiness(data, 50, 10);
    expect(r.status).toBe("partial");
    expect(r.missing).toContain("challenge_results: no rows");
    const after9 = assessNewEpisodes(data, 50, 9);
    // Episode 11 exists only in tribe_mapping, which runs one episode ahead
    // and so never counts as a new episode.
    expect(after9.map((e) => [e.episodeNum, e.status])).toEqual([
      [10, "partial"],
    ]);
    expect(heldReasons(after9)).toHaveLength(1);
  });

  it("imports US50 Episode 9 although tribe_mapping already lists Episode 10", () => {
    // survivoR 403f4a4 ("ADD US50E9"): tribe_mapping runs one episode ahead
    // during a season. Counting it as a new episode would hold every import.
    const data = load("us50-403f4a4");
    expect(
      Math.max(...data.tribeMapping.map((t) => Math.round(t.episode))),
    ).toBe(10);
    const added = assessNewEpisodes(data, 50, 8);
    expect(added.map((e) => [e.episodeNum, e.status, e.missing])).toEqual([
      [9, "complete", []],
    ]);
    expect(assessNewEpisodes(data, 50, 9)).toEqual([]);
  });

  it("reports an episode survivoR has not started as absent", () => {
    const r = assessEpisodeReadiness(load("us51-7336413"), 51, 2);
    expect(r.status).toBe("absent");
    expect(assessNewEpisodes(load("us51-7336413"), 51, 1)).toEqual([]);
  });
});

describe("assessEpisodeReadiness rules", () => {
  const base = load("us51-7336413");

  /** Copy Episode 1's rows into an Episode 2, as survivoR would add it. */
  function withEpisode2(): ReadinessData {
    const data = clone(base);
    const bump = <T extends { episode: number }>(rows: T[]) =>
      rows
        .filter((r) => Math.round(r.episode) === 1)
        .map((r) => ({ ...r, episode: 2 }));
    data.episodes.push(
      ...bump(data.episodes).map((e) => ({
        ...e,
        episode_title: "Second",
        episode_date: "2026-09-30",
      })),
    );
    data.challengeResults.push(
      ...bump(data.challengeResults).map((c) => ({ ...c, challenge_id: 2 })),
    );
    // A second boot: someone still in the game is voted out.
    const next = data.castaways.find((c) => !c.result)!;
    next.result = "2nd voted out";
    next.episode = 2;
    data.voteHistory.push(
      ...bump(data.voteHistory).map((v) => ({
        ...v,
        voted_out_id: next.castaway_id,
      })),
    );
    return data;
  }

  it("accepts a consistent new episode", () => {
    const r = assessEpisodeReadiness(withEpisode2(), 51, 2);
    expect(r.missing).toEqual([]);
    expect(r.status).toBe("complete");
  });

  it("holds an episode with only its episodes row", () => {
    const data = clone(base);
    data.episodes.push({
      ...data.episodes[0],
      episode: 2,
      episode_title: "Second",
    });
    const r = assessEpisodeReadiness(data, 51, 2);
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual(
      expect.arrayContaining([
        "challenge_results: no rows",
        "castaways: nobody left the game this episode",
      ]),
    );
  });

  it("holds a missing episode title or air date, or a duplicate row", () => {
    const untitled = withEpisode2();
    untitled.episodes.at(-1)!.episode_title = "";
    untitled.episodes.at(-1)!.episode_date = "";
    expect(assessEpisodeReadiness(untitled, 51, 2).missing).toEqual([
      "episodes: no title",
      "episodes: no valid air date",
    ]);
    const twice = withEpisode2();
    twice.episodes.push({ ...twice.episodes.at(-1)! });
    expect(assessEpisodeReadiness(twice, 51, 2).missing).toEqual([
      "episodes: 2 rows, expected 1",
    ]);
  });

  it("holds an episode whose predecessor is missing", () => {
    const data = withEpisode2();
    data.episodes = data.episodes.filter((e) => Math.round(e.episode) !== 1);
    expect(assessEpisodeReadiness(data, 51, 2).missing).toContain(
      "episodes: episode 1 missing",
    );
  });

  it("holds an episode with no immunity winner", () => {
    const data = withEpisode2();
    for (const c of data.challengeResults) {
      if (Math.round(c.episode) === 2) c.won = 0;
    }
    expect(assessEpisodeReadiness(data, 51, 2).missing).toEqual([
      "challenge_results: no immunity challenge winner",
    ]);
  });

  it("ignores challenge descriptions, missing or partial", () => {
    const partial = withEpisode2();
    // Episode 2 has no description; another challenge is described but has
    // no results; Episode 1's description is gone.
    partial.challengeDescription = [{ episode: 2, challenge_id: 9 }];
    partial.challengeResults.push({
      ...partial.challengeResults.at(-1)!,
      challenge_id: 4,
    });
    const r = assessEpisodeReadiness(partial, 51, 2);
    expect(r.missing).toEqual([]);
    expect(r.status).toBe("complete");
  });

  it("holds when the boot and the votes disagree", () => {
    const noVotes = withEpisode2();
    noVotes.voteHistory = noVotes.voteHistory.filter(
      (v) => Math.round(v.episode) !== 2,
    );
    expect(assessEpisodeReadiness(noVotes, 51, 2).missing).toEqual([
      "vote_history: no rows for a voted-out castaway",
    ]);

    const wrongBoot = withEpisode2();
    const other = wrongBoot.castaways.find((c) => !c.result)!;
    for (const v of wrongBoot.voteHistory) {
      if (Math.round(v.episode) === 2) v.voted_out_id = other.castaway_id;
    }
    const r = assessEpisodeReadiness(wrongBoot, 51, 2);
    expect(r.missing).toHaveLength(2);
    expect(r.missing[0]).toMatch(/is voted out in castaways only/);
    expect(r.missing[1]).toMatch(/is voted out in vote_history only/);
  });

  it("accepts an episode with no boot only once the next one is listed", () => {
    const data = withEpisode2();
    data.voteHistory = data.voteHistory.filter(
      (v) => Math.round(v.episode) !== 2,
    );
    const booted = data.castaways.find((c) => c.result === "2nd voted out")!;
    booted.result = "";
    booted.episode = 1;
    expect(assessEpisodeReadiness(data, 51, 2).missing).toEqual([
      "castaways: nobody left the game this episode",
    ]);
    data.episodes.push({
      ...data.episodes.at(-1)!,
      episode: 3,
      episode_title: "Third",
    });
    expect(assessEpisodeReadiness(data, 51, 2).status).toBe("complete");
  });

  it("requires tribe_mapping coverage once the season has any", () => {
    const data = withEpisode2();
    const stillIn = data.castaways.filter(
      (c) => !(c.result && Math.round(c.episode) < 2),
    );
    data.tribeMapping = stillIn.slice(1).map((c) => ({
      version: "US",
      version_season: "US51",
      season: 51,
      episode: 2,
      day: 4,
      castaway_id: c.castaway_id,
      castaway: c.castaway,
      tribe: "A",
      tribe_status: "Original",
    }));
    expect(assessEpisodeReadiness(data, 51, 2).missing).toEqual([
      "tribe_mapping: 1 castaway(s) in the game have no row",
    ]);
  });

  it("requires tribe_mapping to show a merge challenge_results shows", () => {
    const data = withEpisode2();
    for (const c of data.challengeResults) {
      if (Math.round(c.episode) === 2) c.tribe_status = "Merged";
    }
    expect(assessEpisodeReadiness(data, 51, 2).missing).toEqual([
      "tribe_mapping: the merge appears in challenge_results but not here",
    ]);
  });

  it("holds a merge while the season has no tribe_mapping at all", () => {
    const data = withEpisode2();
    expect(data.tribeMapping).toEqual([]);
    for (const c of data.challengeResults) {
      if (Math.round(c.episode) === 2) c.tribe_status = "Mergatory";
    }
    expect(assessEpisodeReadiness(data, 51, 2).missing).toEqual([
      "tribe_mapping: the merge appears in challenge_results but not here",
    ]);
  });

  it("raises idol and journey gaps as review notes, never as holds", () => {
    const data = withEpisode2();
    const ep2Votes = data.voteHistory.filter(
      (v) => Math.round(v.episode) === 2,
    );
    ep2Votes[0].immunity = "Hidden";
    ep2Votes[1].vote_event = "Lost vote on journey";
    const r = assessEpisodeReadiness(data, 51, 2);
    expect(r.status).toBe("complete");
    expect(r.reviewNotes.join("\n")).toMatch(/idol protecting/);
    expect(r.reviewNotes.join("\n")).toMatch(/journeys has no row/);
    expect(r.reviewNotes.at(-1)).toMatch(
      /check idol finds, journeys and reward challenges/,
    );
  });
});

describe("US51 Episodes 3 and 4 without challenge descriptions", () => {
  const ep = <T extends { episode: number }>(rows: T[], n: number) =>
    rows.filter((r) => Math.round(r.episode) === n);

  it("imports Episode 3 at 2b8c3a3, where it has no description", () => {
    const data = load("us51-2b8c3a3");
    expect(ep(data.challengeDescription, 3)).toEqual([]);
    const added = assessNewEpisodes(data, 51, 2);
    expect(added.map((e) => [e.episodeNum, e.status, e.missing])).toEqual([
      [3, "complete", []],
    ]);
    expect(heldReasons(added)).toEqual([]);
  });

  it("imports Episode 4 at c0f2511, where only Episodes 1 and 2 are described", () => {
    const data = load("us51-c0f2511");
    expect(
      [...new Set(data.challengeDescription.map((c) => c.episode))].sort(),
    ).toEqual([1, 2]);
    expect([
      ...new Set(ep(data.challengeResults, 4).map((c) => c.challenge_id)),
    ]).toEqual([5]);
    const added = assessNewEpisodes(data, 51, 3);
    expect(added.map((e) => [e.episodeNum, e.status, e.missing])).toEqual([
      [4, "complete", []],
    ]);
    // From the Episode 2 bundle, both undescribed episodes import together.
    expect(
      assessNewEpisodes(data, 51, 2).map((e) => [e.episodeNum, e.status]),
    ).toEqual([
      [3, "complete"],
      [4, "complete"],
    ]);
  });

  it("still holds Episode 4 for a missing scoring input", () => {
    const base = load("us51-c0f2511");

    const noVotes = clone(base);
    noVotes.voteHistory = noVotes.voteHistory.filter(
      (v) => Math.round(v.episode) !== 4,
    );
    expect(assessEpisodeReadiness(noVotes, 51, 4).missing).toEqual([
      "vote_history: no rows for a voted-out castaway",
    ]);

    const noImmunity = clone(base);
    for (const c of ep(noImmunity.challengeResults, 4)) c.won = 0;
    expect(assessEpisodeReadiness(noImmunity, 51, 4).missing).toEqual([
      "challenge_results: no immunity challenge winner",
    ]);

    const noChallenges = clone(base);
    noChallenges.challengeResults = noChallenges.challengeResults.filter(
      (c) => Math.round(c.episode) !== 4,
    );
    expect(assessEpisodeReadiness(noChallenges, 51, 4).missing).toEqual([
      "challenge_results: no rows",
    ]);

    const wrongBoot = clone(base);
    const other = wrongBoot.castaways.find((c) => !c.result)!;
    for (const v of ep(wrongBoot.voteHistory, 4)) {
      v.voted_out_id = other.castaway_id;
    }
    expect(assessEpisodeReadiness(wrongBoot, 51, 4).status).toBe("partial");

    const unmapped = clone(base);
    unmapped.tribeMapping = unmapped.tribeMapping.filter(
      (t) =>
        !(Math.round(t.episode) === 4 && t.castaway_id === other.castaway_id),
    );
    expect(assessEpisodeReadiness(unmapped, 51, 4).missing).toEqual([
      "tribe_mapping: 1 castaway(s) in the game have no row",
    ]);
  });
});

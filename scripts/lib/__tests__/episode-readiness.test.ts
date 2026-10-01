import fs from "fs";
import { describe, expect, it } from "vitest";
import {
  assessEpisodeReadiness,
  assessNewEpisodes,
  heldReasons,
  type ReadinessData,
} from "../episode-readiness";

/*
 * Fixtures are real survivoR rows, trimmed to one season, at three upstream
 * commits:
 * - 7336413 (2026-09-26): US51 Episode 1 complete, the state the app imported.
 * - d4a75af (45 minutes earlier): US51 added without challenge_description.
 * - ba77948 (2026-05-03): US50 Episode 10 with its challenge rows missing,
 *   and Episode 11 only in tribe_mapping. Rows before Episode 9 are trimmed.
 */
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

  it("holds US51 Episode 1 while challenge_description had not landed", () => {
    const r = assessEpisodeReadiness(load("us51-d4a75af"), 51, 1);
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual(["challenge_description: no rows"]);
  });

  it("holds US50 Episode 10 while its challenge results were missing", () => {
    const data = load("us50-ba77948");
    const r = assessEpisodeReadiness(data, 50, 10);
    expect(r.status).toBe("partial");
    expect(r.missing).toContain("challenge_results: no rows");
    const after9 = assessNewEpisodes(data, 50, 9);
    expect(after9.map((e) => [e.episodeNum, e.status])).toEqual([
      [10, "partial"],
      [11, "partial"],
    ]);
    expect(heldReasons(after9)).toHaveLength(2);
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
    data.challengeDescription.push(
      ...bump(data.challengeDescription).map((c) => ({
        ...c,
        challenge_id: 2,
      })),
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
        "challenge_description: no rows",
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

  it("holds when challenge_description and challenge_results disagree", () => {
    const extraDescribed = withEpisode2();
    extraDescribed.challengeDescription.push({
      ...extraDescribed.challengeDescription.at(-1)!,
      challenge_id: 3,
      challenge_type: "Reward",
    });
    expect(assessEpisodeReadiness(extraDescribed, 51, 2).missing).toEqual([
      "challenge_results: no rows for challenge 3",
    ]);
    const undescribed = withEpisode2();
    undescribed.challengeResults.push({
      ...undescribed.challengeResults.at(-1)!,
      challenge_id: 4,
    });
    expect(assessEpisodeReadiness(undescribed, 51, 2).missing).toEqual([
      "challenge_description: no row for challenge 4",
    ]);
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
    expect(r.reviewNotes.at(-1)).toMatch(/check idol finds and journeys/);
  });
});

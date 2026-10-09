import fs from "fs";
import { describe, expect, it } from "vitest";
import {
  assessEpisodeReadiness,
  assessNewEpisodes,
  heldReasons,
  READINESS_WAIVERS,
  type ReadinessData,
} from "../episode-readiness";

/*
 * Fixtures are real survivoR rows, trimmed to one season, at these upstream
 * commits:
 * - 2b8c3a3 (2026-10-09): US51 Episode 3 with every scoring row but no
 *   challenge_description row, the one waived import.
 * - 7336413 (2026-09-26): US51 Episode 1 complete, the state the app imported.
 * - d4a75af (45 minutes earlier): US51 added without challenge_description.
 * - ba77948 (2026-05-03): US50 Episode 10 with its challenge rows missing,
 *   and Episode 11 only in tribe_mapping. Rows before Episode 9 are trimmed.
 * - 403f4a4 (2026-04-23): US50 Episode 9 complete, tribe_mapping already at
 *   Episode 10. Rows before Episode 8 are trimmed.
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
    expect(r.reviewNotes.at(-1)).toMatch(/check idol finds and journeys/);
  });
});

describe("the US51 Episode 3 waiver", () => {
  const WAIVED_REF = "2b8c3a32ed7b2b59e24105b0a89b3322eb1b1b0a";
  const data = load("us51-2b8c3a3");
  const ep3 = <T extends { episode: number }>(rows: T[]) =>
    rows.filter((r) => Math.round(r.episode) === 3);

  it("is the only waiver, and lifts one reason for one episode", () => {
    expect(READINESS_WAIVERS).toEqual([
      expect.objectContaining({
        seasonNum: 51,
        episodeNum: 3,
        upstreamRef: WAIVED_REF,
        missing: "challenge_description: no rows",
        challengeIds: [4],
      }),
    ]);
  });

  it("imports Episode 3 at the inspected commit", () => {
    expect(ep3(data.challengeDescription)).toEqual([]);
    const r = assessEpisodeReadiness(data, 51, 3, WAIVED_REF);
    expect(r.status).toBe("complete");
    expect(r.missing).toEqual([]);
    expect(r.waived).toEqual(["challenge_description: no rows"]);
    expect(r.reviewNotes[0]).toMatch(
      /^waived "challenge_description: no rows"/,
    );

    const added = assessNewEpisodes(data, 51, 2, WAIVED_REF);
    expect(added.map((e) => [e.episodeNum, e.status])).toEqual([
      [3, "complete"],
    ]);
    expect(heldReasons(added)).toEqual([]);
  });

  it("holds the same rows read at master or at any other commit", () => {
    for (const ref of [
      undefined,
      "07ce1660d8312f8e2882244c36dc24fca597998a",
      WAIVED_REF.slice(0, 7),
    ]) {
      const r = assessEpisodeReadiness(data, 51, 3, ref);
      expect(r.status).toBe("partial");
      expect(r.missing).toEqual(["challenge_description: no rows"]);
      expect(r.waived).toEqual([]);
    }
    expect(heldReasons(assessNewEpisodes(data, 51, 2))).toEqual([
      "Episode 3: challenge_description: no rows",
    ]);
  });

  it("still holds Episode 3 for every other missing input", () => {
    const noVotes = clone(data);
    noVotes.voteHistory = noVotes.voteHistory.filter(
      (v) => Math.round(v.episode) !== 3,
    );
    const r = assessEpisodeReadiness(noVotes, 51, 3, WAIVED_REF);
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual([
      "vote_history: no rows for a voted-out castaway",
    ]);

    const noImmunity = clone(data);
    for (const c of ep3(noImmunity.challengeResults)) c.won = 0;
    expect(
      assessEpisodeReadiness(noImmunity, 51, 3, WAIVED_REF).missing,
    ).toEqual(["challenge_results: no immunity challenge winner"]);
  });

  it("does not cover a challenge survivoR adds later", () => {
    const extra = clone(data);
    extra.challengeResults.push(
      ...ep3(extra.challengeResults).map((c) => ({ ...c, challenge_id: 5 })),
    );
    const r = assessEpisodeReadiness(extra, 51, 3, WAIVED_REF);
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual(["challenge_description: no rows"]);
    expect(r.waived).toEqual([]);
  });

  it("checks description rows as usual once survivoR adds them", () => {
    const described = clone(data);
    const template = described.challengeDescription[0];
    described.challengeDescription.push({
      ...template,
      episode: 3,
      challenge_id: 4,
    });
    const r = assessEpisodeReadiness(described, 51, 3, WAIVED_REF);
    expect(r.status).toBe("complete");
    expect(r.waived).toEqual([]);

    described.challengeDescription.push({
      ...template,
      episode: 3,
      challenge_id: 5,
    });
    expect(
      assessEpisodeReadiness(described, 51, 3, WAIVED_REF).missing,
    ).toEqual(["challenge_results: no rows for challenge 5"]);
  });

  it("holds other episodes and seasons read at the waived commit", () => {
    // US51 Episode 1 before its description landed, and US50 Episode 10
    // before its challenge rows did.
    expect(
      assessEpisodeReadiness(load("us51-d4a75af"), 51, 1, WAIVED_REF).missing,
    ).toEqual(["challenge_description: no rows"]);
    const us50 = assessEpisodeReadiness(
      load("us50-ba77948"),
      50,
      10,
      WAIVED_REF,
    );
    expect(us50.status).toBe("partial");
    expect(us50.waived).toEqual([]);

    // Episode 3's rows relabelled as Season 50 or as Episode 4.
    const asSeason50 = assessEpisodeReadiness(data, 50, 3, WAIVED_REF);
    expect(asSeason50.missing).toEqual(["challenge_description: no rows"]);
    const asEpisode4 = clone(data);
    for (const rows of [
      asEpisode4.episodes,
      asEpisode4.challengeResults,
      asEpisode4.voteHistory,
      asEpisode4.castaways,
      asEpisode4.advantageMovement,
    ] as { episode: number }[][]) {
      for (const row of rows)
        if (Math.round(row.episode) === 3) row.episode = 4;
    }
    asEpisode4.episodes.push({ ...ep3(data.episodes)[0] });
    const r4 = assessEpisodeReadiness(asEpisode4, 51, 4, WAIVED_REF);
    expect(r4.missing).toContain("challenge_description: no rows");
    expect(r4.waived).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  assessEpisodeReadiness,
  heldEpisodes,
  upstreamEpisodesAfter,
} from "../episode-readiness";
import type { SurvivorSeasonData } from "../survivor-client";
import type {
  SurvivorCastaway,
  SurvivorChallengeResult,
  SurvivorEpisode,
  SurvivorVoteHistory,
} from "../survivor-types";

const base = { version: "US", version_season: "US51", season: 51 };

function episode(n: number): SurvivorEpisode {
  return {
    ...base,
    episode_number_overall: 688 + n,
    episode: n,
    episode_title: `Episode ${n} title`,
    episode_label: `Ep ${n}`,
    episode_date: `2026-09-${String(16 + 7 * n).padStart(2, "0")}`,
    episode_length: 60,
  } as SurvivorEpisode;
}

function immunity(n: number, castaway_id: string, won: 0 | 1) {
  return {
    ...base,
    episode: n,
    castaway_id,
    challenge_type: "Immunity",
    outcome_type: "Tribal",
    result: won ? "Won" : "Lost",
    won,
  } as SurvivorChallengeResult;
}

function vote(n: number, castaway_id: string, voted_out_id: string) {
  return {
    ...base,
    episode: n,
    castaway_id,
    vote: voted_out_id,
    voted_out: voted_out_id,
    voted_out_id,
  } as SurvivorVoteHistory;
}

function castaway(
  id: string,
  out?: { episode: number; result: string },
): SurvivorCastaway {
  return {
    ...base,
    castaway_id: id,
    full_name: id,
    castaway: id,
    episode: out?.episode ?? null,
    result: out?.result ?? null,
  } as unknown as SurvivorCastaway;
}

/** Episode 1 complete, plus whatever episode 2 rows a test adds. */
function season(ep2: Partial<SurvivorSeasonData> = {}): SurvivorSeasonData {
  return {
    castaways: [
      castaway("US0752", { episode: 1, result: "1st voted out" }),
      castaway("US0753"),
      castaway("US0754"),
      ...(ep2.castaways ?? []),
    ],
    episodes: [episode(1), ...(ep2.episodes ?? [])],
    challengeResults: [
      immunity(1, "US0753", 1),
      immunity(1, "US0752", 0),
      ...(ep2.challengeResults ?? []),
    ],
    voteHistory: [vote(1, "US0754", "US0752"), ...(ep2.voteHistory ?? [])],
    advantageDetails: [],
    advantageMovement: ep2.advantageMovement ?? [],
    tribeMapping: [],
    journeys: ep2.journeys ?? [],
  };
}

const completeEp2 = {
  episodes: [episode(2)],
  challengeResults: [immunity(2, "US0754", 1), immunity(2, "US0753", 0)],
  voteHistory: [vote(2, "US0754", "US0753")],
};
/** Record US0753, the castaway completeEp2 votes out, as leaving in episode 2. */
function withEp2Boot(data: SurvivorSeasonData): SurvivorSeasonData {
  return {
    ...data,
    castaways: data.castaways
      .filter((c) => c.castaway_id !== "US0753")
      .concat(castaway("US0753", { episode: 2, result: "2nd voted out" })),
  };
}

describe("assessEpisodeReadiness", () => {
  it("reports absent when no table has a row for the episode", () => {
    const r = assessEpisodeReadiness(season(), 51, 2);
    expect(r.status).toBe("absent");
    expect(r.counts.episodes).toBe(0);
  });

  it("treats an episodes listing alone as partial, not scoreable", () => {
    const r = assessEpisodeReadiness(season({ episodes: [episode(2)] }), 51, 2);
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual(
      expect.arrayContaining([
        "challenge_results: no rows",
        "castaways: nobody left the game this episode",
      ]),
    );
  });

  it("is partial when the boot is recorded but vote history has not landed", () => {
    const data = withEp2Boot(
      season({
        episodes: [episode(2)],
        challengeResults: completeEp2.challengeResults,
      }),
    );
    const r = assessEpisodeReadiness(data, 51, 2);
    expect(r.status).toBe("partial");
    expect(r.missing).toContain(
      "vote_history: no rows for a voted-out castaway",
    );
  });

  it("is partial when votes name a boot that castaways does not", () => {
    const data = season({
      episodes: [episode(2)],
      challengeResults: completeEp2.challengeResults,
      voteHistory: completeEp2.voteHistory,
    });
    const r = assessEpisodeReadiness(data, 51, 2);
    expect(r.status).toBe("partial");
    expect(r.missing).toContain(
      "castaways: US0753 is voted out in vote_history only",
    );
  });

  it("is partial without an immunity winner", () => {
    const data = withEp2Boot(
      season({
        ...completeEp2,
        challengeResults: [immunity(2, "US0754", 0)],
      }),
    );
    expect(assessEpisodeReadiness(data, 51, 2).missing).toContain(
      "challenge_results: no immunity challenge winner",
    );
  });

  it("is partial when survivoR lists the episode twice", () => {
    const data = withEp2Boot(
      season({ ...completeEp2, episodes: [episode(2), episode(2)] }),
    );
    expect(assessEpisodeReadiness(data, 51, 2).missing).toContain(
      "episodes: 2 rows, expected 1",
    );
  });

  it("is partial when the previous episode is missing", () => {
    const data = withEp2Boot(season(completeEp2));
    data.episodes = data.episodes.filter((e) => e.episode !== 1);
    expect(assessEpisodeReadiness(data, 51, 2).missing).toContain(
      "episodes: episode 1 missing",
    );
  });

  it("is complete when every scoring table agrees", () => {
    const r = assessEpisodeReadiness(withEp2Boot(season(completeEp2)), 51, 2);
    expect(r).toMatchObject({ status: "complete", missing: [] });
    expect(r.counts).toMatchObject({
      episodes: 1,
      challengeResults: 2,
      voteHistory: 1,
      castawaysOut: 1,
    });
  });

  it("accepts an episode with no vote and no boot only once the next one is listed", () => {
    const noTribal = season({
      episodes: [episode(2)],
      challengeResults: completeEp2.challengeResults,
    });
    expect(assessEpisodeReadiness(noTribal, 51, 2).status).toBe("partial");

    noTribal.episodes.push(episode(3));
    expect(assessEpisodeReadiness(noTribal, 51, 2).status).toBe("complete");
  });
});

describe("upstreamEpisodesAfter", () => {
  it("finds an episode that so far exists only outside episodes.json", () => {
    const data = season({ challengeResults: [immunity(2, "US0754", 1)] });
    expect(upstreamEpisodesAfter(data, 1)).toEqual([2]);
    expect(upstreamEpisodesAfter(data, 2)).toEqual([]);
  });
});

describe("heldEpisodes", () => {
  it("holds a partial newer episode and lets a complete one through", () => {
    const partial = season({ episodes: [episode(2)] });
    expect(heldEpisodes(partial, 51, 1)).toHaveLength(1);
    expect(heldEpisodes(partial, 51, 1)[0]).toMatch(/^Episode 2: /);

    expect(heldEpisodes(withEp2Boot(season(completeEp2)), 51, 1)).toEqual([]);
  });

  it("does not re-check episodes already committed", () => {
    expect(heldEpisodes(season(), 51, 1)).toEqual([]);
  });
});

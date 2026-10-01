import { describe, expect, it } from "vitest";
import type { EpisodeReadiness } from "../episode-readiness";
import {
  decideEpisodeWatch,
  parseWatchConfig,
  type EpisodeWatchObservation,
} from "../episode-watch";
import { buildWatchIssue, watchIssueTitle } from "../episode-watch-report";

const config = {
  seasonNum: 51,
  episodeNum: 2,
  deadline: "2026-10-15T14:00:00Z",
};
const beforeDeadline = new Date("2026-10-02T00:00:00Z");
const afterDeadline = new Date("2026-10-15T14:00:01Z");

function upstream(status: EpisodeReadiness["status"]): EpisodeReadiness {
  return {
    seasonNum: 51,
    episodeNum: 2,
    status,
    missing: status === "complete" ? [] : ["challenge_results: no rows"],
    counts: {
      episodes: status === "absent" ? 0 : 1,
      challengeResults: 0,
      voteHistory: 0,
      castawaysOut: 0,
      advantageMovement: 0,
      journeys: 0,
    },
  };
}

function observe(
  status: EpisodeReadiness["status"],
  app: Partial<Omit<EpisodeWatchObservation, "upstream">> = {},
): EpisodeWatchObservation {
  return {
    upstream: upstream(status),
    bundleEpisodes: 1,
    firestoreEpisodes: 1,
    poolLatestEpisode: 1,
    ...app,
  };
}

const published = {
  bundleEpisodes: 2,
  firestoreEpisodes: 2,
  poolLatestEpisode: 2,
};

describe("decideEpisodeWatch", () => {
  it("waits quietly while survivoR has nothing", () => {
    expect(
      decideEpisodeWatch(config, observe("absent"), beforeDeadline),
    ).toMatchObject({
      state: "waiting_upstream",
      terminal: false,
      alert: false,
    });
  });

  it("never offers a partial episode for import", () => {
    expect(
      decideEpisodeWatch(config, observe("partial"), beforeDeadline),
    ).toMatchObject({
      state: "partial_upstream",
      terminal: false,
      alert: false,
    });
  });

  it("alerts once survivoR is complete and main lacks the episode", () => {
    expect(
      decideEpisodeWatch(config, observe("complete"), beforeDeadline),
    ).toMatchObject({ state: "ready_to_import", terminal: false, alert: true });
  });

  it("names what production still lacks after the merge", () => {
    const firestoreBehind = decideEpisodeWatch(
      config,
      observe("complete", { bundleEpisodes: 2 }),
      beforeDeadline,
    );
    expect(firestoreBehind.state).toBe("awaiting_publication");
    expect(firestoreBehind.summary).toContain("production season document");

    const standingsBehind = decideEpisodeWatch(
      config,
      observe("complete", { bundleEpisodes: 2, firestoreEpisodes: 2 }),
      beforeDeadline,
    );
    expect(standingsBehind.state).toBe("awaiting_publication");
    expect(standingsBehind.summary).toBe(
      "Season 51 episode 2 is on main; still missing from: pool standings.",
    );
  });

  it("stops on verified publication, even past the deadline", () => {
    for (const now of [beforeDeadline, afterDeadline]) {
      expect(
        decideEpisodeWatch(config, observe("complete", published), now),
      ).toMatchObject({ state: "published", terminal: true, alert: false });
    }
  });

  it("does not need standings when the season has no pool", () => {
    expect(
      decideEpisodeWatch(
        config,
        observe("complete", { ...published, poolLatestEpisode: null }),
        beforeDeadline,
      ).state,
    ).toBe("published");
  });

  it("flags app data that got ahead of a partial survivoR", () => {
    expect(
      decideEpisodeWatch(
        config,
        observe("partial", { firestoreEpisodes: 2 }),
        beforeDeadline,
      ),
    ).toMatchObject({ state: "inconsistent", terminal: false, alert: true });
  });

  it("expires with an alert when nothing was published in time", () => {
    for (const status of ["absent", "partial", "complete"] as const) {
      expect(
        decideEpisodeWatch(config, observe(status), afterDeadline),
      ).toMatchObject({ state: "expired", terminal: true, alert: true });
    }
  });

  it("decides the same way on a repeated run", () => {
    const obs = observe("complete");
    expect(decideEpisodeWatch(config, obs, beforeDeadline)).toEqual(
      decideEpisodeWatch(config, obs, beforeDeadline),
    );
  });
});

describe("parseWatchConfig", () => {
  it("reads the repository variable", () => {
    expect(
      parseWatchConfig(
        '{"season":51,"episode":2,"deadline":"2026-10-15T14:00:00Z"}',
      ),
    ).toEqual(config);
  });

  it.each([
    ["not json", /not JSON/],
    ['{"season":51,"episode":2}', /deadline/],
    ['{"season":"51","episode":2,"deadline":"2026-10-15"}', /season/],
    ['{"season":51,"episode":0,"deadline":"2026-10-15"}', /episode/],
    ['{"season":51,"episode":2,"deadline":"soon"}', /deadline/],
  ])("rejects %s", (raw, message) => {
    expect(() => parseWatchConfig(raw)).toThrow(message);
  });
});

describe("buildWatchIssue", () => {
  const evidence = {
    checkedAt: "2026-10-02T00:00:00.000Z",
    upstreamSha: "a".repeat(40),
    upstreamCommitUrl: `https://github.com/doehm/survivoR/commit/${"a".repeat(40)}`,
    upstreamTablesUrl: `https://github.com/doehm/survivoR/tree/${"a".repeat(40)}/dev/json`,
    seasonDocUrl: "https://firestore.example/seasons/season_51",
    poolDocUrl: "https://firestore.example/pools/pool_season_51",
  };

  it("keeps one title per episode so runs edit rather than duplicate", () => {
    const a = buildWatchIssue(
      config,
      observe("absent"),
      decideEpisodeWatch(config, observe("absent"), beforeDeadline),
      evidence,
    );
    const b = buildWatchIssue(
      config,
      observe("complete"),
      decideEpisodeWatch(config, observe("complete"), beforeDeadline),
      evidence,
    );
    expect(a.title).toBe("Episode watch: Season 51 episode 2");
    expect(b.title).toBe(a.title);
    expect(watchIssueTitle(config)).toBe(a.title);
  });

  it("gives the reviewed import steps and the upstream evidence when ready", () => {
    const obs = observe("complete");
    const { body } = buildWatchIssue(
      config,
      obs,
      decideEpisodeWatch(config, obs, beforeDeadline),
      evidence,
    );
    expect(body).toContain("**State:** `ready_to_import`");
    expect(body).toContain("scripts/sync-season.ts --no-push");
    expect(body).toContain("yarn tsx scripts/push-seasons.ts 51 --dry-run");
    expect(body).toContain(evidence.upstreamCommitUrl);
    expect(body).toContain("Deadline: 2026-10-15T14:00:00Z");
  });
});

import { describe, expect, it } from "vitest";
import { SCORING_REVISION } from "../../data/scoringRevision.generated";
import {
  Challenge,
  Elimination,
  Episode,
  GameEvent,
  SeasonRevisionPayload,
} from "../../types";
import {
  buildSeasonRevisionStamp,
  computeSeasonDataRevision,
  removeById,
  removeEpisode,
  upsertById,
  upsertEpisode,
} from "../seasonRevision";

const episode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: "season_51",
  season_num: 51,
  order,
  name: `Episode ${order}`,
  finale: false,
  post_merge: false,
  merge_occurs: false,
});

const event = (id: string, action: GameEvent["action"]): GameEvent => ({
  id: `event_${id}`,
  season_id: "season_51",
  season_num: 51,
  episode_id: "episode_1",
  episode_num: 1,
  action,
  multiplier: null,
  castaway_id: "US0752",
});

const challenge = (id: string, order: number): Challenge => ({
  id: `challenge_${id}`,
  season_id: "season_51",
  season_num: 51,
  episode_id: "episode_1",
  episode_num: 1,
  order,
  variant: "immunity",
  winning_castaways: ["US0752"],
});

const elimination = (id: string, order: number): Elimination => ({
  id: `elimination_${id}`,
  season_id: "season_51",
  season_num: 51,
  episode_id: "episode_1",
  episode_num: 1,
  castaway_id: "US0753",
  order,
  variant: "tribal",
});

const basePayload = (): SeasonRevisionPayload => ({
  episodes: [episode(1), episode(2)],
  challenges: { [challenge("a", 1).id]: challenge("a", 1) },
  eliminations: { [elimination("a", 1).id]: elimination("a", 1) },
  events: { [event("a", "find_idol").id]: event("a", "find_idol") },
});

describe("computeSeasonDataRevision", () => {
  it("is stable across two computations of identical season data", () => {
    expect(computeSeasonDataRevision(basePayload())).toBe(
      computeSeasonDataRevision(basePayload()),
    );
  });

  it("ignores object key insertion order, which Firestore does not preserve", () => {
    const a = basePayload();
    const b: SeasonRevisionPayload = {
      ...a,
      events: {
        [event("b", "use_idol").id]: event("b", "use_idol"),
        [event("a", "find_idol").id]: event("a", "find_idol"),
      },
    };
    const c: SeasonRevisionPayload = {
      ...a,
      events: {
        [event("a", "find_idol").id]: event("a", "find_idol"),
        [event("b", "use_idol").id]: event("b", "use_idol"),
      },
    };

    expect(computeSeasonDataRevision(b)).toBe(computeSeasonDataRevision(c));
  });

  it("changes when a single event is added", () => {
    const before = basePayload();
    const after: SeasonRevisionPayload = {
      ...before,
      events: upsertById(before.events, event("b", "use_idol")),
    };

    expect(computeSeasonDataRevision(after)).not.toBe(
      computeSeasonDataRevision(before),
    );
  });

  it("changes when a single event is removed", () => {
    const before = basePayload();
    const after: SeasonRevisionPayload = {
      ...before,
      events: removeById(before.events, "event_a"),
    };

    expect(computeSeasonDataRevision(after)).not.toBe(
      computeSeasonDataRevision(before),
    );
  });

  it("changes when a single event is edited", () => {
    const before = basePayload();
    const after: SeasonRevisionPayload = {
      ...before,
      events: upsertById(before.events, event("a", "win_fire_making")),
    };

    expect(computeSeasonDataRevision(after)).not.toBe(
      computeSeasonDataRevision(before),
    );
  });

  it("treats an absent optional field and an undefined one as the same data", () => {
    const withUndefined = basePayload();
    withUndefined.eliminations = {
      elimination_a: { ...elimination("a", 1), votes_received: undefined },
    };

    expect(computeSeasonDataRevision(withUndefined)).toBe(
      computeSeasonDataRevision(basePayload()),
    );
  });
});

describe("admin CRUD paths bump the data revision", () => {
  it("bumps when an event is added", () => {
    const before = basePayload();
    const after = {
      ...before,
      events: upsertById(before.events, event("new", "find_idol")),
    };

    expect(buildSeasonRevisionStamp(after).data_revision).not.toBe(
      buildSeasonRevisionStamp(before).data_revision,
    );
  });

  it("bumps when a challenge is edited", () => {
    const before = basePayload();
    const edited: Challenge = { ...challenge("a", 1), variant: "reward" };
    const after = {
      ...before,
      challenges: upsertById(before.challenges, edited),
    };

    expect(buildSeasonRevisionStamp(after).data_revision).not.toBe(
      buildSeasonRevisionStamp(before).data_revision,
    );
  });

  it("bumps when an elimination is deleted", () => {
    const before = basePayload();
    const after = {
      ...before,
      eliminations: removeById(before.eliminations, "elimination_a"),
    };

    expect(buildSeasonRevisionStamp(after).data_revision).not.toBe(
      buildSeasonRevisionStamp(before).data_revision,
    );
  });

  it("bumps when an episode is added, edited, or removed", () => {
    const before = basePayload();
    const added = {
      ...before,
      episodes: upsertEpisode(before.episodes, episode(3)),
    };
    const edited = {
      ...before,
      episodes: upsertEpisode(before.episodes, {
        ...episode(2),
        finale: true,
      }),
    };
    const removed = {
      ...before,
      episodes: removeEpisode(before.episodes, "episode_2"),
    };

    const baseRevision = buildSeasonRevisionStamp(before).data_revision;
    expect(buildSeasonRevisionStamp(added).data_revision).not.toBe(
      baseRevision,
    );
    expect(buildSeasonRevisionStamp(edited).data_revision).not.toBe(
      baseRevision,
    );
    expect(buildSeasonRevisionStamp(removed).data_revision).not.toBe(
      baseRevision,
    );
  });

  it("does not reorder episodes into a different revision", () => {
    const before = basePayload();
    const reversed = { ...before, episodes: [...before.episodes].reverse() };

    expect(buildSeasonRevisionStamp(reversed).data_revision).toBe(
      buildSeasonRevisionStamp(before).data_revision,
    );
  });
});

describe("buildSeasonRevisionStamp", () => {
  it("carries the generated scoring revision alongside the data revision", () => {
    const stamp = buildSeasonRevisionStamp(basePayload());

    expect(stamp).toEqual({
      data_revision: computeSeasonDataRevision(basePayload()),
      scoring_revision: SCORING_REVISION,
    });
  });
});

describe("upsertById and removeById", () => {
  it("do not mutate their input", () => {
    const events = basePayload().events;
    upsertById(events, event("b", "use_idol"));
    removeById(events, "event_a");

    expect(Object.keys(events)).toEqual(["event_a"]);
  });
});

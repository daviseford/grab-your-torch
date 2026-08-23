import { describe, expect, it } from "vitest";
import { SEASON_METADATA } from "../season-metadata";

/**
 * `complete` drives the live season treatment (the On air slot, the live
 * badge, the homepage guide). It is hand-maintained, so this keeps it honest
 * against the season data itself: a season is complete exactly when its
 * events include a declared winner (`win_survivor`).
 */
type SeasonModule = Record<string, unknown>;

const modules = import.meta.glob<SeasonModule>("../season_*/index.ts", {
  eager: true,
});

const hasDeclaredWinner = (mod: SeasonModule) => {
  const eventsKey = Object.keys(mod).find((key) =>
    /^SEASON_\d+_EVENTS$/.test(key),
  );
  if (!eventsKey) return false;
  const events = Object.values(
    mod[eventsKey] as Record<string, { action: string }>,
  );
  return events.some((event) => event.action === "win_survivor");
};

describe("season completion", () => {
  it("marks a season complete exactly when its data declares a winner", () => {
    const mismatches: string[] = [];
    for (const [path, mod] of Object.entries(modules)) {
      const id = path.match(
        /(season_\d+)/,
      )?.[1] as keyof typeof SEASON_METADATA;
      const meta = SEASON_METADATA[id];
      if (!meta) continue;
      const winner = hasDeclaredWinner(mod);
      if (meta.complete !== winner) {
        mismatches.push(
          `${id}: complete=${meta.complete} but winner declared=${winner}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("covers every registered season", () => {
    expect(Object.keys(modules).length).toBe(
      Object.keys(SEASON_METADATA).length,
    );
  });
});

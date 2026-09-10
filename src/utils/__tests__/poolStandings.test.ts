import { describe, expect, it } from "vitest";
import { PoolStandingsRow } from "../../types";
import {
  POOL_STANDINGS_PAGE_ROWS,
  POOL_STANDINGS_SUMMARY_ROWS,
  buildPoolStandingsDocuments,
} from "../poolStandings";

const rows = (count: number): PoolStandingsRow[] =>
  Array.from({ length: count }, (_, i) => ({
    // 24 characters, the handle cap, so every row is the widest it can be.
    handle: `handle-${String(i).padStart(16, "0")}`,
    total: 1000 - i,
    prop_bet_points: 10,
    rank: i + 1,
  }));

const meta = {
  episode_num: 3,
  computed_at: "2026-09-24T04:00:00.000Z",
  data_revision: "aaaaaaaaaaaaaaaa",
  scoring_revision: "bbbbbbbbbbbbbbbb",
  freeze_at: "2026-09-24T00:00:00.000Z",
};

describe("buildPoolStandingsDocuments", () => {
  it("keeps the summary document constant in size as the entrant count grows", () => {
    const sizes = [100, 1000, 5000].map(
      (count) =>
        JSON.stringify(buildPoolStandingsDocuments(rows(count), meta).summary)
          .length,
    );

    // entry_count is the only field that widens, and only by digits.
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(4);
    expect(sizes[0]).toBeGreaterThan(0);
  });

  it("publishes no more than the summary row cap in the summary document", () => {
    const { summary } = buildPoolStandingsDocuments(rows(5000), meta);

    expect(summary.rows).toHaveLength(POOL_STANDINGS_SUMMARY_ROWS);
    expect(summary.entry_count).toBe(5000);
  });

  it("never publishes a uid, because standings are world-readable", () => {
    const { summary, pages } = buildPoolStandingsDocuments(rows(1200), meta);

    expect(JSON.stringify({ summary, pages })).not.toContain("uid");
  });

  it("splits every row across overflow pages of a fixed size", () => {
    const { pages } = buildPoolStandingsDocuments(rows(1200), meta);

    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatchObject({ page: 0, rows: expect.any(Array) });
    expect(pages[0].rows).toHaveLength(POOL_STANDINGS_PAGE_ROWS);
    expect(pages[2].rows).toHaveLength(200);
    expect(pages.flatMap((p) => p.rows)).toHaveLength(1200);
  });

  it("emits no overflow pages when every entrant fits in the summary", () => {
    const { summary, pages } = buildPoolStandingsDocuments(rows(12), meta);

    expect(summary.rows).toHaveLength(12);
    expect(pages).toHaveLength(0);
  });

  it("stamps the episode, the time, and the inputs it was computed from", () => {
    const { summary } = buildPoolStandingsDocuments(rows(3), meta);

    expect(summary).toMatchObject(meta);
  });
});

import { describe, expect, it } from "vitest";
import { SEASON_METADATA } from "../season-metadata";
import { SEASONS } from "../seasons";

describe("SEASON_METADATA", () => {
  const entries = Object.entries(SEASON_METADATA);
  const values = Object.values(SEASON_METADATA);

  it("has exactly 51 entries", () => {
    expect(entries.length).toBe(51);
  });

  it("every key matches season_N pattern and equals the entry id", () => {
    for (const [key, meta] of entries) {
      expect(key).toMatch(/^season_\d+$/);
      expect(key).toBe(meta.id);
      expect(key).toBe(`season_${meta.order}`);
    }
  });

  it("order values are unique and cover 1-51", () => {
    const orders = values.map((m) => m.order).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 51 }, (_, i) => i + 1));
  });

  it("premiere dates are ISO dates and only set on incomplete seasons", () => {
    for (const meta of values) {
      if (meta.premiere === undefined) continue;
      expect(meta.premiere).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(meta.complete).toBe(false);
    }
  });

  it("every entry has a valid year and contestant count", () => {
    for (const meta of values) {
      expect(meta.year).toBeGreaterThanOrEqual(2000);
      expect(meta.year).toBeLessThanOrEqual(2030);
      expect(meta.contestantCount).toBeGreaterThan(0);
    }
  });

  it("seasons 41+ have null subtitle", () => {
    for (const meta of values) {
      if (meta.order >= 41) {
        expect(meta.subtitle).toBeNull();
      }
    }
  });

  it("seasons 1-40 have non-null subtitle", () => {
    for (const meta of values) {
      if (meta.order >= 1 && meta.order <= 40) {
        expect(meta.subtitle).not.toBeNull();
        expect(meta.subtitle!.length).toBeGreaterThan(0);
      }
    }
  });

  it("every entry has a boolean complete field", () => {
    for (const meta of values) {
      expect(typeof meta.complete).toBe("boolean");
    }
  });

  it("at most one season is incomplete (currently airing)", () => {
    const incomplete = values.filter((m) => !m.complete);
    expect(incomplete.length).toBeLessThanOrEqual(1);
  });

  it("every season in SEASONS also appears in SEASON_METADATA", () => {
    for (const key of Object.keys(SEASONS)) {
      expect(SEASON_METADATA).toHaveProperty(key);
    }
  });
});

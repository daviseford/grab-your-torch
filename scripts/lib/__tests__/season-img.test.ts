import * as fs from "fs";
import { describe, expect, it } from "vitest";
import {
  readLocalSeasonImg,
  resolveSeasonImg,
  SEASONS_FILE_PATH,
} from "../season-img";

describe("readLocalSeasonImg", () => {
  it("reads the committed Season 51 logo", () => {
    expect(
      readLocalSeasonImg(fs.readFileSync(SEASONS_FILE_PATH, "utf-8"), 51),
    ).toBe("/images/season_51/season-51-logo.webp");
  });

  it("reads an entry without a logo as empty, not the next season's logo", () => {
    const source = `
  season_52: {
    id: "season_52" as const,
    players: SEASON_52_PLAYERS,
  },
  season_53: {
    id: "season_53" as const,
    img: "/images/season_53/logo.webp",
  },`;

    expect(readLocalSeasonImg(source, 52)).toBe("");
    expect(readLocalSeasonImg(source, 53)).toBe("/images/season_53/logo.webp");
  });

  // push-all-seasons, sync-season and push-seasons all read logos through
  // this, so every registered season must read its own entry's value.
  it("reads each registered season's own logo from the committed seasons.ts", () => {
    const source = fs.readFileSync(SEASONS_FILE_PATH, "utf-8");
    const entries = [
      ...source.matchAll(/^ {2}season_(\d+): \{\n([\s\S]*?)^ {2}\},?$/gm),
    ];
    expect(entries.length).toBeGreaterThan(40);

    for (const [, num, body] of entries) {
      const own = body.match(/^ {4}img: "([^"]*)",$/m)?.[1] ?? "";
      expect(readLocalSeasonImg(source, Number(num)), `season_${num}`).toBe(
        own,
      );
    }
  });
});

describe("resolveSeasonImg", () => {
  it("writes a logo set in seasons.ts, replacing a different stored one", () => {
    expect(resolveSeasonImg("/new.webp", "/old.webp")).toBe("/new.webp");
  });

  it("keeps the stored logo when seasons.ts has none", () => {
    expect(resolveSeasonImg("", "/stored.webp")).toBe("/stored.webp");
  });

  it("writes an empty logo only when neither side has one", () => {
    expect(resolveSeasonImg("", undefined)).toBe("");
    expect(resolveSeasonImg("", 42)).toBe("");
  });
});

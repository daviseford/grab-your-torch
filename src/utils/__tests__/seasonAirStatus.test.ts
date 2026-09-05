import { describe, expect, it } from "vitest";
import { formatPremiereDate, getSeasonAirStatus } from "../seasonAirStatus";

// Noon Pacific on 2026-09-05, well before Survivor 51's premiere.
const NOW = new Date("2026-09-05T19:00:00Z");

describe("getSeasonAirStatus", () => {
  it("is complete once the data declares a winner", () => {
    expect(
      getSeasonAirStatus({ complete: true, premiere: "2026-09-23" }, NOW),
    ).toBe("complete");
  });

  it("is upcoming before the premiere date", () => {
    expect(
      getSeasonAirStatus({ complete: false, premiere: "2026-09-23" }, NOW),
    ).toBe("upcoming");
  });

  it("is live from the premiere date onward", () => {
    expect(
      getSeasonAirStatus({ complete: false, premiere: "2026-09-05" }, NOW),
    ).toBe("live");
    expect(
      getSeasonAirStatus({ complete: false, premiere: "2026-02-25" }, NOW),
    ).toBe("live");
  });

  it("treats an incomplete season without a premiere date as live", () => {
    expect(getSeasonAirStatus({ complete: false }, NOW)).toBe("live");
  });
});

describe("formatPremiereDate", () => {
  it("prints the month and day", () => {
    expect(formatPremiereDate("2026-09-23")).toBe("September 23");
  });
});

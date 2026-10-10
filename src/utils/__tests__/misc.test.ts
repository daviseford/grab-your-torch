import { describe, expect, it } from "vitest";
import { SlimUser } from "../../types";
import { formatPoints, getParticipantName } from "../misc";

const participants: SlimUser[] = [
  {
    uid: "uid_a",
    email: "a@example.com",
    displayName: "Alice",
    isAdmin: false,
  },
  { uid: "uid_b", email: "b@example.com", displayName: null, isAdmin: false },
];

describe("getParticipantName", () => {
  it("prefers the per-competition team name", () => {
    expect(
      getParticipantName(participants, "uid_a", { uid_a: "Jeff's Babes" }),
    ).toBe("Jeff's Babes");
  });

  it("falls back to displayName when no team name is set", () => {
    expect(getParticipantName(participants, "uid_a", {})).toBe("Alice");
    expect(getParticipantName(participants, "uid_a")).toBe("Alice");
  });

  it("ignores team names of other participants", () => {
    expect(getParticipantName(participants, "uid_b", { uid_a: "X" })).toBe(
      "b@example.com",
    );
  });

  it("falls back to email when displayName is null", () => {
    expect(getParticipantName(participants, "uid_b")).toBe("b@example.com");
  });

  it("returns a placeholder for an unknown uid", () => {
    expect(getParticipantName(participants, "uid_zzz", {})).toBe(
      "Unknown participant",
    );
  });
});

describe("formatPoints", () => {
  it("signs positive points", () => {
    expect(formatPoints(3)).toBe("+3");
    expect(formatPoints(0.5)).toBe("+0.5");
  });

  it("shows negative points with a single minus sign", () => {
    expect(formatPoints(-2)).toBe("-2");
    expect(formatPoints(-0.5)).toBe("-0.5");
  });

  it("leaves zero unsigned", () => {
    expect(formatPoints(0)).toBe("0");
  });
});

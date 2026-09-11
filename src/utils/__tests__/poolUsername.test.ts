import { describe, expect, it } from "vitest";
import { validatePoolHandle } from "../poolHandle";
import { poolUsername } from "../poolUsername";

describe("poolUsername", () => {
  it.each(["davis", "José O’Neill", "王小明", "Torch 🔥", "A"])(
    "preserves the account username %s",
    (name) => {
      expect(poolUsername(name)).toBe(name);
      expect(validatePoolHandle(poolUsername(name))).toBeNull();
    },
  );

  it("uses a neutral fallback for an incomplete account profile, never an email", () => {
    expect(poolUsername(null)).toBe("Survivor fan");
    expect(poolUsername(undefined)).toBe("Survivor fan");
  });

  it("removes invisible controls and surrounding spaces", () => {
    expect(poolUsername("  Torch\u200b\nFan  ")).toBe("TorchFan");
  });

  it("bounds long names without splitting an emoji", () => {
    const name = poolUsername("a".repeat(99) + "🔥");
    expect(name).toBe("a".repeat(99));
    expect(validatePoolHandle(name)).toBeNull();
  });
});

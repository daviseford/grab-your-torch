import { GoogleAuthProvider } from "firebase/auth";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_PROVIDER,
  resolveSocialDisplayName,
  SOCIAL_PROVIDERS,
} from "../socialProviders";

describe("SOCIAL_PROVIDERS", () => {
  it("offers Google only", () => {
    expect(SOCIAL_PROVIDERS.map((p) => p.id)).toEqual(["google"]);
    expect(GOOGLE_PROVIDER.label).toBe("Google");
    expect(GOOGLE_PROVIDER.analyticsMethod).toBe("google");
    expect(GOOGLE_PROVIDER.createAuthProvider()).toBeInstanceOf(
      GoogleAuthProvider,
    );
  });

  it("forces the Google account chooser", () => {
    const provider = GOOGLE_PROVIDER.createAuthProvider() as GoogleAuthProvider;
    expect(provider.getCustomParameters()).toEqual({
      prompt: "select_account",
    });
  });

  it("builds a fresh provider per attempt so custom parameters never leak", () => {
    expect(GOOGLE_PROVIDER.createAuthProvider()).not.toBe(
      GOOGLE_PROVIDER.createAuthProvider(),
    );
  });
});

describe("resolveSocialDisplayName", () => {
  it("prefers the name Firebase already resolved", () => {
    expect(resolveSocialDisplayName(" Jane Doe ", { name: "janedoe" })).toBe(
      "Jane Doe",
    );
  });

  it("falls back to the raw profile name", () => {
    expect(resolveSocialDisplayName(null, { name: "Jane" })).toBe("Jane");
    expect(resolveSocialDisplayName("", { name: " Jane " })).toBe("Jane");
  });

  it("ignores blank and non-string profile values", () => {
    expect(resolveSocialDisplayName(null, { name: "  " })).toBeNull();
    expect(resolveSocialDisplayName(null, { name: 42 })).toBeNull();
    expect(resolveSocialDisplayName(null, null)).toBeNull();
    expect(resolveSocialDisplayName(undefined, undefined)).toBeNull();
  });
});

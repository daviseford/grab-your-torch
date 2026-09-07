import { GoogleAuthProvider, OAuthProvider } from "firebase/auth";
import { describe, expect, it } from "vitest";
import {
  getEnabledSocialProviders,
  isOidcProviderId,
  resolveSocialDisplayName,
} from "../socialProviders";

describe("getEnabledSocialProviders", () => {
  it("always offers Google first", () => {
    const [google] = getEnabledSocialProviders({});
    expect(google.id).toBe("google");
    expect(google.label).toBe("Google");
    expect(google.createAuthProvider()).toBeInstanceOf(GoogleAuthProvider);
  });

  it("hides Discord when no provider id is configured", () => {
    expect(getEnabledSocialProviders({}).map((p) => p.id)).toEqual(["google"]);
    expect(
      getEnabledSocialProviders({ VITE_AUTH_DISCORD_PROVIDER_ID: "" }).map(
        (p) => p.id,
      ),
    ).toEqual(["google"]);
    expect(
      getEnabledSocialProviders({ VITE_AUTH_DISCORD_PROVIDER_ID: "   " }).map(
        (p) => p.id,
      ),
    ).toEqual(["google"]);
  });

  it("hides Discord when the provider id is not an Identity Platform OIDC id", () => {
    for (const bad of ["discord", "discord.com", "oidc.", "oidc.dis cord"]) {
      expect(
        getEnabledSocialProviders({ VITE_AUTH_DISCORD_PROVIDER_ID: bad }).map(
          (p) => p.id,
        ),
      ).toEqual(["google"]);
    }
  });

  it("offers Discord after Google as an OIDC provider with identity scopes", () => {
    const providers = getEnabledSocialProviders({
      VITE_AUTH_DISCORD_PROVIDER_ID: " oidc.discord ",
    });
    expect(providers.map((p) => p.id)).toEqual(["google", "discord"]);

    const discord = providers[1].createAuthProvider();
    expect(discord).toBeInstanceOf(OAuthProvider);
    expect(discord.providerId).toBe("oidc.discord");
    expect((discord as OAuthProvider).getScopes()).toEqual([
      "identify",
      "email",
    ]);
  });

  it("builds a fresh provider per attempt so custom parameters never leak", () => {
    const [google] = getEnabledSocialProviders({});
    expect(google.createAuthProvider()).not.toBe(google.createAuthProvider());
  });
});

describe("isOidcProviderId", () => {
  it("accepts oidc.<name> and rejects everything else", () => {
    expect(isOidcProviderId("oidc.discord")).toBe(true);
    expect(isOidcProviderId("oidc.my-provider_2")).toBe(true);
    expect(isOidcProviderId("google.com")).toBe(false);
    expect(isOidcProviderId(undefined)).toBe(false);
    expect(isOidcProviderId(null)).toBe(false);
  });
});

describe("resolveSocialDisplayName", () => {
  it("prefers the name Firebase already resolved", () => {
    expect(
      resolveSocialDisplayName(" Jane Doe ", { global_name: "janedoe" }),
    ).toBe("Jane Doe");
  });

  it("falls back through the raw profile in a fixed order", () => {
    expect(
      resolveSocialDisplayName(null, {
        username: "jd",
        preferred_username: "jane.d",
        global_name: "Jane",
      }),
    ).toBe("Jane");
    expect(
      resolveSocialDisplayName("", {
        username: "jd",
        preferred_username: "jane.d",
      }),
    ).toBe("jane.d");
    expect(resolveSocialDisplayName(undefined, { username: "jd" })).toBe("jd");
  });

  it("ignores blank and non-string profile values", () => {
    expect(
      resolveSocialDisplayName(null, {
        global_name: "  ",
        name: 42,
        preferred_username: null,
      }),
    ).toBeNull();
    expect(resolveSocialDisplayName(null, null)).toBeNull();
    expect(resolveSocialDisplayName(undefined, undefined)).toBeNull();
  });
});

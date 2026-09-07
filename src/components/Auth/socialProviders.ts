/**
 * Social sign-in provider catalog.
 *
 * Google is a native Firebase Auth provider and is always offered. Discord is
 * not native: it is wired through an Identity Platform OpenID Connect
 * provider (Discord publishes an OIDC issuer at https://discord.com), whose
 * provider id is supplied at build time via VITE_AUTH_DISCORD_PROVIDER_ID.
 * When that variable is unset or malformed, the Discord button is hidden and
 * nothing else changes. See docs/social-login-setup.md.
 */

import {
  GoogleAuthProvider,
  OAuthProvider,
  type AuthProvider,
} from "firebase/auth";

export type SocialProviderId = "google" | "discord";

export type SocialProvider = {
  id: SocialProviderId;
  /** Human label; buttons render "Continue with {label}". */
  label: string;
  /** GA4 `method` param for `login` and `sign_up` events. */
  analyticsMethod: string;
  /** Build a fresh Firebase provider for one sign-in attempt. */
  createAuthProvider: () => AuthProvider;
};

export type SocialAuthEnv = {
  VITE_AUTH_DISCORD_PROVIDER_ID?: string;
};

const GOOGLE: SocialProvider = {
  id: "google",
  label: "Google",
  analyticsMethod: "google",
  createAuthProvider: () => {
    const provider = new GoogleAuthProvider();
    // Always show the account chooser so a shared browser never silently
    // reuses whichever Google session happens to be active.
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  },
};

// Identity Platform names every OpenID Connect provider `oidc.<name>`.
const OIDC_PROVIDER_ID = /^oidc\.[A-Za-z0-9_-]+$/;

/** True when the value is a well-formed Identity Platform OIDC provider id. */
export const isOidcProviderId = (
  value: string | undefined | null,
): value is string => typeof value === "string" && OIDC_PROVIDER_ID.test(value);

const discord = (providerId: string): SocialProvider => ({
  id: "discord",
  label: "Discord",
  analyticsMethod: "discord",
  createAuthProvider: () => {
    const provider = new OAuthProvider(providerId);
    // Discord only returns the account email (and a stable identity) when
    // both scopes are granted alongside the implicit `openid` scope.
    provider.addScope("identify");
    provider.addScope("email");
    return provider;
  },
});

/**
 * Providers to offer, in display order. Reads the Discord provider id from
 * the Vite env by default; tests pass an explicit env.
 */
export const getEnabledSocialProviders = (
  env: SocialAuthEnv = import.meta.env,
): SocialProvider[] => {
  const providers = [GOOGLE];
  const discordId = env.VITE_AUTH_DISCORD_PROVIDER_ID?.trim();
  if (isOidcProviderId(discordId)) {
    providers.push(discord(discordId));
  }
  return providers;
};

// Raw profile keys consulted, in order, when the provider gave Firebase no
// display name. Discord's OIDC userinfo exposes the display name as
// `global_name` and the handle as `preferred_username` / `username`.
const PROFILE_NAME_KEYS = [
  "global_name",
  "name",
  "preferred_username",
  "username",
];

/**
 * Pick the display name to store for a first-time social sign-in: the name
 * Firebase already resolved, else the first usable name in the provider's
 * raw profile, else null (the app then falls back to the email).
 */
export const resolveSocialDisplayName = (
  displayName: string | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): string | null => {
  const resolved = displayName?.trim();
  if (resolved) return resolved;

  for (const key of PROFILE_NAME_KEYS) {
    const value = profile?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

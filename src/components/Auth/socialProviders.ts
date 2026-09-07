/**
 * Social sign-in provider catalog. Google is the only provider offered; it
 * is native to Firebase Auth and needs no build-time configuration beyond
 * enabling it in the Firebase console. See docs/social-login-setup.md.
 */

import { GoogleAuthProvider, type AuthProvider } from "firebase/auth";

export type SocialProviderId = "google";

export type SocialProvider = {
  id: SocialProviderId;
  /** Human label; buttons render "Continue with {label}". */
  label: string;
  /** GA4 `method` param for `login` and `sign_up` events. */
  analyticsMethod: string;
  /** Build a fresh Firebase provider for one sign-in attempt. */
  createAuthProvider: () => AuthProvider;
};

export const GOOGLE_PROVIDER: SocialProvider = {
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

/** Providers to offer, in display order. */
export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [GOOGLE_PROVIDER];

/**
 * Pick the display name to store for a first-time social sign-in: the name
 * Firebase already resolved, else the `name` claim in the provider's raw
 * profile, else null (the app then falls back to the email).
 */
export const resolveSocialDisplayName = (
  displayName: string | null | undefined,
  profile: Record<string, unknown> | null | undefined,
): string | null => {
  const resolved = displayName?.trim();
  if (resolved) return resolved;

  const name = profile?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return null;
};

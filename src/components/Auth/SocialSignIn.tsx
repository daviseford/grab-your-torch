import { Button, Divider, Stack, Text } from "@mantine/core";
import { IconBrandDiscord, IconBrandGoogle } from "@tabler/icons-react";
import {
  getAdditionalUserInfo,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { ReactNode, useState } from "react";
import { auth, db } from "../../firebase";
import { trackEvent } from "../../utils/analytics";
import { mapAuthError } from "./authErrors";
import type { AuthFormOutcome, AuthFormProps } from "./AuthModal";
import {
  getEnabledSocialProviders,
  resolveSocialDisplayName,
  type SocialProvider,
  type SocialProviderId,
} from "./socialProviders";

const SETUP_WARNING_MESSAGE =
  "You are signed in, but profile setup did not finish. Your email will show as your name for now, and you can update your profile later.";

const ICONS: Record<SocialProviderId, ReactNode> = {
  google: <IconBrandGoogle size={18} aria-hidden />,
  discord: <IconBrandDiscord size={18} aria-hidden />,
};

// Resolved once: the enabled set is fixed at build time.
const DEFAULT_PROVIDERS = getEnabledSocialProviders();

export type SocialSignInProps = Pick<
  AuthFormProps,
  "pending" | "onPendingChange" | "onOutcome"
> & {
  /** Overrides the build-time provider set (tests). */
  providers?: SocialProvider[];
};

/**
 * "Continue with Google / Discord" buttons plus the divider that separates
 * them from the email form. A first sign-in provisions the user document the
 * same way Register does; a returning sign-in just reports success.
 */
export const SocialSignIn = ({
  pending: pendingProp,
  onPendingChange,
  onOutcome,
  providers = DEFAULT_PROVIDERS,
}: SocialSignInProps = {}) => {
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<SocialProviderId | null>(null);

  const pending = pendingProp ?? localPending;
  const setPending = onPendingChange ?? setLocalPending;

  const report = (outcome: AuthFormOutcome) => {
    setActiveId(null);
    if (onOutcome) {
      onOutcome(outcome);
    } else {
      setPending(false);
      if (outcome.status === "error") {
        setLocalError(outcome.error.message);
      }
    }
  };

  const handleSignIn = async (provider: SocialProvider) => {
    if (pending) return;

    setPending(true);
    setActiveId(provider.id);
    setLocalError(null);

    let credential;
    try {
      credential = await signInWithPopup(auth, provider.createAuthProvider());
    } catch (error) {
      const mapped = mapAuthError(error);
      // Closing the popup is not a failure; just release the form.
      report(
        mapped.category === "cancelled"
          ? { status: "cancelled" }
          : { status: "error", error: mapped },
      );
      return;
    }

    const info = getAdditionalUserInfo(credential);
    const isNewUser = info?.isNewUser ?? false;
    trackEvent(isNewUser ? "sign_up" : "login", {
      method: provider.analyticsMethod,
    });

    if (!isNewUser) {
      report({ status: "authenticated" });
      return;
    }

    // First sign-in with this provider: provision the profile and the user
    // document exactly as Register does. The Auth account already exists, so
    // a failure here is a retryable setup warning, not a sign-in failure.
    try {
      const { user } = credential;
      const displayName = resolveSocialDisplayName(
        user.displayName,
        info?.profile,
      );
      if (displayName && displayName !== user.displayName) {
        await updateProfile(user, { displayName });
      }
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: displayName ?? "",
      });
      report({ status: "authenticated" });
    } catch {
      report({ status: "setup-warning", message: SETUP_WARNING_MESSAGE });
    }
  };

  if (providers.length === 0) return null;

  return (
    <>
      <Stack gap="sm" mt="md">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="default"
            fullWidth
            leftSection={ICONS[provider.id]}
            loading={activeId === provider.id}
            disabled={pending && activeId !== provider.id}
            onClick={() => handleSignIn(provider)}
          >
            Continue with {provider.label}
          </Button>
        ))}
        {localError && <Text c="red">{localError}</Text>}
      </Stack>
      <Divider label="or use your email" labelPosition="center" mt="lg" />
    </>
  );
};

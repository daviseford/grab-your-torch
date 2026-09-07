import {
  Alert,
  Button,
  Group,
  Tabs,
  Text,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import type { ContextModalProps } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import type { AuthError } from "./authErrors";
import { claimAuthIntent } from "./authIntent";
import { ForgotPassword } from "./ForgotPassword";
import { Login } from "./Login";
import { Register } from "./Register";
import { SocialSignIn } from "./SocialSignIn";

export type AuthMode = "login" | "register" | "forgot-password";

/** Structured result reported by an account form to the modal owner. */
export type AuthFormOutcome =
  | { status: "authenticated" }
  | { status: "setup-warning"; message: string }
  | { status: "confirmed"; message: string }
  | { status: "cancelled" }
  | { status: "error"; error: AuthError };

/** Props accepted by the account forms. Optional so they still render standalone. */
export type AuthFormProps = {
  email?: string;
  onEmailChange?: (email: string) => void;
  pending?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onOutcome?: (outcome: AuthFormOutcome) => void;
};

export type AuthModalInnerProps = {
  /** Which form to show first. Defaults to "login". */
  initialMode?: AuthMode;
  /**
   * Pre-fill the shared email field, e.g. the verified account email after
   * an app-owned password reset. Defaults to empty.
   */
  initialEmail?: string;
  /** Short human label for the action that continues after auth. */
  actionDescription?: string;
  /**
   * The state key of the single-use intent saved by the gate that opened
   * this modal. Set only when the modal owns a pending intent; dismissal
   * cancels exactly that record and leaves every other tab's intent alone.
   */
  pendingStateKey?: string;
  /** Fired exactly once after a successful login or registration. */
  onAuthenticated?: () => void;
};

const MODE_HEADINGS: Record<AuthMode, string> = {
  login: "Sign in",
  register: "Create account",
  "forgot-password": "Reset your password",
};

const PENDING_MESSAGES: Record<AuthMode, string> = {
  login: "Signing you in...",
  register: "Creating your account...",
  "forgot-password": "Sending the reset email...",
};

// Only one AuthModal is ever open at a time, so a module-level handle is safe.
let scheduledIntentClear: ReturnType<typeof setTimeout> | undefined;

export const AuthModal = ({
  context,
  id,
  innerProps,
}: ContextModalProps<AuthModalInnerProps>) => {
  const {
    initialMode = "login",
    initialEmail = "",
    actionDescription,
    pendingStateKey,
    onAuthenticated,
  } = innerProps;

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Hides the forms during the modal's closing animation: once auth succeeds
  // the user state arrives before the modal finishes closing, and Register
  // would otherwise flash its "already signed in" guard.
  const [completing, setCompleting] = useState(false);
  const completedRef = useRef(false);
  const resetRequestSentRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Dismissal without a successful auth (close button, Escape, click outside)
  // is a cancellation: drop the intent this modal owns so an abandoned action
  // can never execute later. The success path sets completedRef before
  // closing, and a sent reset email sets resetRequestSentRef because the
  // emailed continue URL points at the intent's state key, so it must stay
  // pending. Modals that own no intent (navbar, competitions, reset page)
  // clear nothing. The clear is scheduled and cancelled on remount because
  // React Strict Mode runs this cleanup once immediately after mount; a real
  // dismissal never remounts, so its scheduled clear always runs.
  useEffect(() => {
    if (scheduledIntentClear !== undefined) {
      clearTimeout(scheduledIntentClear);
      scheduledIntentClear = undefined;
    }
    return () => {
      if (
        !completedRef.current &&
        !resetRequestSentRef.current &&
        pendingStateKey
      ) {
        scheduledIntentClear = setTimeout(() => {
          scheduledIntentClear = undefined;
          // Claim and discard: cancellation removes only this modal's record.
          claimAuthIntent(pendingStateKey);
        }, 0);
      }
    };
  }, [pendingStateKey]);

  // Move focus to the mode heading on every mode change.
  useEffect(() => {
    headingRef.current?.focus();
  }, [mode]);

  const switchMode = (nextMode: AuthMode) => {
    setError(null);
    setConfirmation(null);
    setMode(nextMode);
  };

  const complete = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setCompleting(true);
    onAuthenticated?.();
    context.closeModal(id);
  };

  const handleOutcome = (outcome: AuthFormOutcome) => {
    setPending(false);

    switch (outcome.status) {
      case "authenticated":
        complete();
        break;
      case "setup-warning":
        // KTD4: the Auth account exists, so this still completes. The
        // warning is non-blocking and survives the modal closing.
        notifications.show({
          color: "yellow",
          title: "Profile setup incomplete",
          message: outcome.message,
        });
        complete();
        break;
      case "confirmed":
        // The reset email's continue URL carries the pending intent's state
        // key, so dismissal after this point must leave that intent alone.
        resetRequestSentRef.current = true;
        setError(null);
        setConfirmation(outcome.message);
        break;
      case "cancelled":
        // A closed social sign-in popup: nothing to show, form released.
        break;
      case "error":
        setConfirmation(null);
        setError(outcome.error);
        break;
    }
  };

  const formProps: AuthFormProps = {
    email,
    onEmailChange: setEmail,
    pending,
    onPendingChange: setPending,
    onOutcome: handleOutcome,
  };

  const liveMessage = pending
    ? PENDING_MESSAGES[mode]
    : (error?.message ?? confirmation ?? "");

  return (
    <div>
      <Title order={2} ta="center" tabIndex={-1} ref={headingRef}>
        {MODE_HEADINGS[mode]}
      </Title>
      {actionDescription && (
        <Text ta="center" c="dimmed" mt="xs">
          {actionDescription}
        </Text>
      )}

      <VisuallyHidden aria-live="polite">{liveMessage}</VisuallyHidden>

      {mode !== "forgot-password" && (
        <Tabs
          value={mode}
          onChange={(value) => {
            if (value === "login" || value === "register") {
              switchMode(value);
            }
          }}
          mt="md"
        >
          <Tabs.List grow>
            <Tabs.Tab value="login">Sign in</Tabs.Tab>
            <Tabs.Tab value="register">Create account</Tabs.Tab>
          </Tabs.List>
        </Tabs>
      )}

      {error && (
        <Alert color="red" mt="md">
          {error.message}
          {error.category === "email-in-use" && (
            <Group mt="sm" gap="xs">
              <Button
                size="xs"
                variant="light"
                onClick={() => switchMode("login")}
              >
                Sign in instead
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => switchMode("forgot-password")}
              >
                Reset your password
              </Button>
            </Group>
          )}
        </Alert>
      )}

      {confirmation && (
        <Alert color="green" mt="md">
          {confirmation}
        </Alert>
      )}

      {!completing && mode !== "forgot-password" && (
        <SocialSignIn
          pending={pending}
          onPendingChange={setPending}
          onOutcome={handleOutcome}
        />
      )}

      {!completing && mode === "login" && (
        <Login
          {...formProps}
          onForgotPassword={() => switchMode("forgot-password")}
        />
      )}
      {!completing && mode === "register" && <Register {...formProps} />}
      {!completing && mode === "forgot-password" && (
        <ForgotPassword
          {...formProps}
          pendingStateKey={pendingStateKey}
          onBackToSignIn={() => switchMode("login")}
        />
      )}
    </div>
  );
};

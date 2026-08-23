import { Anchor, Button, Paper, Text, TextInput } from "@mantine/core";
import { sendPasswordResetEmail } from "firebase/auth";
import { FormEvent, useState } from "react";
import { auth } from "../../firebase";
import { getResetRequestOutcome } from "./authErrors";
import type { AuthFormProps } from "./AuthModal";

export type ForgotPasswordProps = AuthFormProps & {
  /**
   * The state key of the pending intent owned by the modal that rendered
   * this form. When provided, the reset email's continue URL carries exactly
   * this key; when absent, the email carries no state at all.
   */
  pendingStateKey?: string;
  /** Switches the modal back to the sign-in mode, keeping the email. */
  onBackToSignIn?: () => void;
};

export const ForgotPassword = ({
  email: emailProp,
  onEmailChange,
  pending: pendingProp,
  onPendingChange,
  onOutcome,
  pendingStateKey,
  onBackToSignIn,
}: ForgotPasswordProps = {}) => {
  const [localEmail, setLocalEmail] = useState("");
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localConfirmation, setLocalConfirmation] = useState<string | null>(
    null,
  );

  const email = emailProp ?? localEmail;
  const setEmail = onEmailChange ?? setLocalEmail;
  const pending = pendingProp ?? localPending;
  const setPending = onPendingChange ?? setLocalPending;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;

    setPending(true);
    setLocalError(null);
    setLocalConfirmation(null);

    let failure: unknown = null;
    try {
      // Land the reset link on the app-owned handler. The continue URL
      // carries only the opaque state key of the intent this modal owns
      // (threaded down from the gate that saved it; the owning route still
      // claims it), never raw intent fields. Without an owning key the
      // email carries no state, never an arbitrary scanned intent.
      const actionCodeSettings = {
        url: `${window.location.origin}/reset-password${
          pendingStateKey ? `?state=${pendingStateKey}` : ""
        }`,
        handleCodeInApp: false,
      };
      await sendPasswordResetEmail(auth, email, actionCodeSettings);
    } catch (error) {
      failure = error;
    }

    // KTD5: the confirmation is identical whether or not the email identifies
    // an account; only genuine service failures surface an error.
    const outcome = getResetRequestOutcome(failure);

    if (outcome.status === "confirmed") {
      if (onOutcome) {
        onOutcome({ status: "confirmed", message: outcome.message });
      } else {
        setPending(false);
        setLocalConfirmation(outcome.message);
      }
    } else {
      if (onOutcome) {
        onOutcome({ status: "error", error: outcome.error });
      } else {
        setPending(false);
        setLocalError(outcome.error.message);
      }
    }
  };

  return (
    <Paper p={0} mt="md">
      <Text size="sm" c="dimmed">
        Enter your account email and we will send you a reset link.
      </Text>
      <form onSubmit={onSubmit}>
        <TextInput
          label="Email"
          placeholder="hello@gmail.com"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
          mt="md"
        />

        {localConfirmation && (
          <Text c="green" mt="lg">
            {localConfirmation}
          </Text>
        )}

        {localError && (
          <Text c="red" mt="lg">
            {localError}
          </Text>
        )}

        <Button fullWidth mt="xl" type="submit" loading={pending}>
          Send reset email
        </Button>
      </form>

      {onBackToSignIn && (
        <Anchor
          component="button"
          type="button"
          size="sm"
          mt="md"
          onClick={onBackToSignIn}
        >
          Back to sign in
        </Anchor>
      )}
    </Paper>
  );
};

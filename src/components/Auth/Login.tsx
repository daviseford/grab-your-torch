import {
  Anchor,
  Button,
  Paper,
  PasswordInput,
  Text,
  TextInput,
} from "@mantine/core";
import { signInWithEmailAndPassword } from "firebase/auth";
import { FormEvent, useState } from "react";
import { auth } from "../../firebase";
import { trackEvent } from "../../utils/analytics";
import { mapAuthError } from "./authErrors";
import type { AuthFormProps } from "./AuthModal";

export type LoginProps = AuthFormProps & {
  /** Switches the modal to the reset-request mode, keeping the email. */
  onForgotPassword?: () => void;
};

export const Login = ({
  email: emailProp,
  onEmailChange,
  pending: pendingProp,
  onPendingChange,
  onOutcome,
  onForgotPassword,
}: LoginProps = {}) => {
  const [localEmail, setLocalEmail] = useState("");
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const email = emailProp ?? localEmail;
  const setEmail = onEmailChange ?? setLocalEmail;
  const pending = pendingProp ?? localPending;
  const setPending = onPendingChange ?? setLocalPending;

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;

    setPending(true);
    setLocalError(null);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      trackEvent("login", { method: "password" });
      if (onOutcome) {
        onOutcome({ status: "authenticated" });
      } else {
        setPending(false);
      }
    } catch (error) {
      const mapped = mapAuthError(error);
      if (onOutcome) {
        onOutcome({ status: "error", error: mapped });
      } else {
        setPending(false);
        setLocalError(mapped.message);
      }
    }
  };

  return (
    <Paper p={0} mt="md">
      <form onSubmit={onLogin}>
        <TextInput
          label="Email"
          placeholder="hello@gmail.com"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Password"
          placeholder="Your password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          required
          mt="md"
        />

        {onForgotPassword && (
          <Anchor
            component="button"
            type="button"
            size="sm"
            mt="sm"
            onClick={onForgotPassword}
          >
            Forgot password?
          </Anchor>
        )}

        {localError && (
          <Text c="red" mt="lg">
            {localError}
          </Text>
        )}

        <Button fullWidth mt="xl" type="submit" loading={pending}>
          Sign in
        </Button>
      </form>
    </Paper>
  );
};

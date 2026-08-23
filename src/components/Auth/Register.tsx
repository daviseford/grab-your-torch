import {
  Button,
  Paper,
  PasswordInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { auth, db } from "../../firebase";
import { useUser } from "../../hooks/useUser";
import { trackEvent } from "../../utils/analytics";
import { mapAuthError } from "./authErrors";
import type { AuthFormOutcome, AuthFormProps } from "./AuthModal";

const SETUP_WARNING_MESSAGE =
  "Your account was created and you are signed in, but profile setup did not finish. Your email will show as your name for now, and you can update your profile later.";

export const Register = ({
  email: emailProp,
  onEmailChange,
  pending: pendingProp,
  onPendingChange,
  onOutcome,
}: AuthFormProps = {}) => {
  const { user } = useUser();

  const [displayName, setDisplayName] = useState("");
  const [localEmail, setLocalEmail] = useState("");
  const [localPending, setLocalPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const email = emailProp ?? localEmail;
  const setEmail = onEmailChange ?? setLocalEmail;
  const pending = pendingProp ?? localPending;
  const setPending = onPendingChange ?? setLocalPending;

  const report = (outcome: AuthFormOutcome) => {
    if (onOutcome) {
      onOutcome(outcome);
    } else {
      setPending(false);
      if (outcome.status === "error") {
        setLocalError(outcome.error.message);
      }
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;

    setPending(true);
    setLocalError(null);

    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
    } catch (error) {
      // The account was not created, so this is a real registration failure.
      report({ status: "error", error: mapAuthError(error) });
      return;
    }

    // The Auth account now exists; the sign-up event fires exactly once here.
    trackEvent("sign_up", { method: "password" });

    // KTD4: profile and user-document provisioning are separate from account
    // creation. A failure here is a retryable setup warning, not a
    // registration failure, and must not send the user back to sign up.
    try {
      if (displayName) {
        await updateProfile(userCredential.user, { displayName });
      }

      const { uid } = userCredential.user;
      await setDoc(doc(db, "users", uid), {
        uid,
        email: userCredential.user.email,
        displayName,
      });

      report({ status: "authenticated" });
    } catch {
      report({ status: "setup-warning", message: SETUP_WARNING_MESSAGE });
    }
  };

  if (user) {
    return (
      <Paper p="md" mt="md" ta="center">
        <Title order={3}>You are already signed in.</Title>
        <Button mt="md" onClick={() => auth.signOut()}>
          Sign out
        </Button>
      </Paper>
    );
  }

  return (
    <Paper p={0} mt="md">
      <form onSubmit={onSubmit}>
        <TextInput
          label="Display Name"
          placeholder="John Doe"
          description="Other users will see this name"
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
          required
        />
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
        <PasswordInput
          label="Password"
          placeholder="Your password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          required
          mt="md"
        />

        {localError && (
          <Text c="red" mt="lg">
            {localError}
          </Text>
        )}

        <Button fullWidth mt="xl" type="submit" loading={pending}>
          Create account
        </Button>
      </form>
    </Paper>
  );
};

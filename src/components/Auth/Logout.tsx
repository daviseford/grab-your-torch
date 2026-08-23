import { Button, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { auth } from "../../firebase";
import { StandbySlate } from "../Layout/StandbySlate";
import { clearAuthIntents } from "./authIntent";

/**
 * Shared signed-out landing. Both operations below are idempotent, so the
 * double effect run under React Strict Mode is safe: intents are cleared and
 * the user is signed out exactly as on a single run.
 */
export const Logout = () => {
  useEffect(() => {
    clearAuthIntents();
    auth.signOut();
  }, []);

  return (
    <StandbySlate
      code="Signed out"
      actions={
        <>
          <Button
            size="md"
            onClick={() =>
              modals.openContextModal({
                modal: "AuthModal",
                innerProps: { initialMode: "login" },
              })
            }
          >
            Sign in
          </Button>
          <Button
            component={Link}
            to="/"
            variant="outline"
            size="md"
            color="dark.0"
          >
            Back to home
          </Button>
        </>
      }
    >
      <Title order={1}>You're signed out</Title>
      <Text c="dimmed" size="sm" maw={420}>
        Thanks for playing. Sign back in to pick up your drafts and
        competitions, or keep browsing seasons and castaways for free.
      </Text>
    </StandbySlate>
  );
};

import { Button, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { auth } from "../../firebase";
import { clearAllPoolEntryDrafts } from "../../utils/poolDraftStorage";
import { StandbySlate } from "../Layout/StandbySlate";
import { clearAuthIntents } from "./authIntent";

/**
 * Shared signed-out landing. All three operations below are idempotent, so the
 * double effect run under React Strict Mode is safe: intents and autosaved
 * entries are cleared and the user is signed out exactly as on a single run.
 *
 * The pool entry autosave is cleared in the same gesture as the intents, and
 * not separately: the intent carries the resume marker and the autosave
 * carries the entry, so dropping one without the other would leave this
 * browser holding a signed-out person's picks for whoever opens it next
 * (R10 + KTD1).
 */
export const Logout = () => {
  useEffect(() => {
    clearAuthIntents();
    clearAllPoolEntryDrafts();
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

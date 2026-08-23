import { Button } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { saveAuthIntent, type AuthIntent } from "../components/Auth/authIntent";
import {
  EmptySlate,
  Notice,
  PageIntro,
  RouteLoading,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { SEASON_METADATA, type SeasonMeta } from "../data/season-metadata";
import { useAuthContinuation } from "../hooks/useAuthContinuation";
import { useCreateDraft } from "../hooks/useCreateDraft";
import { useSeason } from "../hooks/useSeason";
import { useUser } from "../hooks/useUser";
import { trackEvent } from "../utils/analytics";
import { generateDraftId } from "../utils/draftRealtime";
import { Players } from "./Players";
import classes from "./SingleSeason.module.css";

export const SingleSeason = () => {
  const navigate = useNavigate();

  const { data: season, isLoading } = useSeason();
  const { slimUser } = useUser();
  const { createDraft } = useCreateDraft();
  const [isCreating, setIsCreating] = useState(false);
  const [pendingStateKey, setPendingStateKey] = useState<string | null>(null);

  useEffect(() => {
    if (season) {
      trackEvent("season_viewed", { season_num: season.order });
    }
  }, [season]);

  const handleCreateDraft = async () => {
    if (isCreating || !slimUser || !season) return;
    setIsCreating(true);
    const outcome = await createDraft({ user: slimUser });
    if (outcome.status === "failed") {
      setIsCreating(false);
      notifications.show({
        title: "Failed to create draft",
        message: "Check your connection and try again.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      return;
    }
    navigate(`/seasons/${season.id}/draft/${outcome.draftId}`);
  };

  // Signed-out start: retain the action as a single-use intent with a
  // preallocated draft ID, then open account entry. The continuation below
  // executes it exactly once after authentication.
  const handleStartDraftIntent = (mode: "login" | "register") => {
    if (!season) return;
    const stateKey = saveAuthIntent({
      kind: "start-draft",
      seasonId: season.id,
      draftId: generateDraftId(),
      returnPath: `/seasons/${season.id}`,
    });
    setPendingStateKey(stateKey);
    modals.openContextModal({
      modal: "AuthModal",
      innerProps: {
        initialMode: mode,
        actionDescription: `Start a draft for ${season.name}`,
        pendingStateKey: stateKey,
      },
    });
  };

  const executeStartIntent = useCallback(
    async (intent: AuthIntent) => {
      if (intent.kind !== "start-draft" || !slimUser || !season) {
        return {
          result: "failed" as const,
          message:
            "We couldn't finish setting up your draft. Check your connection and try again.",
        };
      }
      const outcome = await createDraft({
        user: slimUser,
        draftId: intent.draftId,
      });
      if (outcome.status === "failed") {
        if (outcome.reason === "permission") {
          return {
            result: "invalid" as const,
            message:
              "Your account isn't allowed to start a draft for this season.",
          };
        }
        return {
          result: "failed" as const,
          message:
            "We couldn't create your draft. Check your connection and try again.",
        };
      }
      // created or already-created: the draft lobby exists either way.
      navigate(`/seasons/${season.id}/draft/${outcome.draftId}`);
      return { result: "completed" as const };
    },
    [createDraft, slimUser, season, navigate],
  );

  const matchesStartIntent = useCallback(
    (intent: AuthIntent) =>
      intent.kind === "start-draft" && intent.seasonId === season?.id,
    [season?.id],
  );

  const continuation = useAuthContinuation({
    isReady: !!slimUser && !!season,
    stateKey: pendingStateKey,
    matches: matchesStartIntent,
    execute: executeStartIntent,
  });

  useBugContext(season ? `Season ${season.order} · Cast` : null);

  if (isLoading) return <RouteLoading />;

  if (!season)
    return (
      <div className={classes.page}>
        <EmptySlate
          title="Season not found"
          actions={
            <Button component={Link} to="/seasons" variant="outline" size="sm">
              Back to Seasons
            </Button>
          }
        >
          We couldn't find this season. It may have been removed or the link may
          be incorrect.
        </EmptySlate>
      </div>
    );

  // Catalog facts (location, year, airing state) live in the lightweight
  // metadata; the season document itself carries the cast.
  const meta: SeasonMeta | undefined = SEASON_METADATA[season.id];
  const live = meta ? !meta.complete : false;
  const castCount = season.players?.length ?? 0;

  return (
    <div className={classes.page}>
      {continuation.status === "executing" && (
        <Notice label="Setting up" role="status">
          Setting up your draft...
        </Notice>
      )}
      {continuation.status === "failed" && (
        <Notice
          label="Failed"
          tone="danger"
          role="alert"
          actions={
            <Button size="xs" variant="default" onClick={continuation.retry}>
              Try again
            </Button>
          }
        >
          {continuation.error}
        </Notice>
      )}
      {continuation.status === "invalid" && (
        <Notice
          label="Unavailable"
          tone="warning"
          role="alert"
          actions={
            <Button size="xs" variant="default" component={Link} to="/seasons">
              Back to Seasons
            </Button>
          }
        >
          {continuation.error}
        </Notice>
      )}

      <PageIntro
        eyebrow="Seasons"
        context={live ? `On air · Season ${season.order}` : undefined}
        title={season.name}
        description={
          <>
            {meta && (
              <>
                {meta.location} &middot; {meta.year}.{" "}
              </>
            )}
            Meet the cast. When you're ready, start a draft and invite your
            friends to build their rosters.
          </>
        }
        meta={
          <>
            <StatusBadge kind="season">Season {season.order}</StatusBadge>
            <StatusBadge kind="complete">{castCount} castaways</StatusBadge>
          </>
        }
        actions={
          slimUser ? (
            <div className={classes.start}>
              <Button
                size="md"
                onClick={handleCreateDraft}
                loading={isCreating}
              >
                Start a draft
              </Button>
              <span className={classes.hint}>
                You'll get a link to share with friends
              </span>
            </div>
          ) : (
            <div className={classes.auth}>
              <p className={classes.authCopy}>
                Start a draft with friends: create a free account or sign in.
              </p>
              <div className={classes.authSlates}>
                <Button onClick={() => handleStartDraftIntent("register")}>
                  Create account
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleStartDraftIntent("login")}
                >
                  Sign in
                </Button>
              </div>
            </div>
          )
        }
      />

      <section aria-labelledby="season-cast" className={classes.cast}>
        <div className={classes.sectionLabel}>
          <h2 id="season-cast" className={classes.sectionTitle}>
            Cast &middot; {castCount} castaways
          </h2>
        </div>
        <Players />
      </section>

      {slimUser && (
        <div className={classes.closing}>
          <Button size="md" onClick={handleCreateDraft} loading={isCreating}>
            Start a draft with {season.name}
          </Button>
          <span className={classes.hint}>
            You'll get a shareable link to invite friends
          </span>
        </div>
      )}
    </div>
  );
};

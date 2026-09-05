import {
  Alert,
  Button,
  Center,
  CopyButton,
  Image,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { isNotEmpty, useForm } from "@mantine/form";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { ref, runTransaction, set, update } from "firebase/database";
import { doc, setDoc } from "firebase/firestore";
import { shuffle } from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { v4 } from "uuid";
import { saveAuthIntent, type AuthIntent } from "../components/Auth/authIntent";
import { DraftOrderReveal } from "../components/DraftOrderReveal";
import { DraftTable } from "../components/DraftTable";
import {
  Board,
  Notice,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { PostDraftPropBetTable } from "../components/PropBetTables/PostDraftPropBetTable";
import {
  PropBetQuestionKey,
  PropBetQuestionKeys,
  PropBetsQuestions,
} from "../data/propbets";
import { db, rt_db } from "../firebase";
import {
  decideJoinContinuation,
  useAuthContinuation,
} from "../hooks/useAuthContinuation";
import { useCompetition } from "../hooks/useCompetition";
import { useDraft } from "../hooks/useDraft";
import { useSeason } from "../hooks/useSeason";
import { useUser } from "../hooks/useUser";
import {
  CastawayId,
  Competition,
  Draft,
  Player,
  PropBetsEntry,
  PropBetsFormData,
  Season,
  SlimUser,
} from "../types";
import { trackEvent } from "../utils/analytics";
import {
  buildPickOrderUidMap,
  buildTurnsMap,
  planDraftPicks,
} from "../utils/draftRealtime";
import { recordRecentDraft, removeRecentDraft } from "../utils/recentDrafts";
import classes from "./Draft.module.css";
import { DraftBoard } from "./DraftBoard";
import { DraftCastGrid } from "./DraftCastGrid";
import {
  DraftHowItWorks,
  DraftParticipants,
  DraftScoringReference,
} from "./DraftLobby";
import { participantName } from "./DraftNames";
import { DraftSpine } from "./DraftSpine";
import { DraftSteps } from "./DraftSteps";

/** Rounds shown on the lobby's empty board before the real count is known. */
const LOBBY_PREVIEW_ROUNDS = 6;

export const DraftComponent = () => {
  const navigate = useNavigate();

  const { slimUser } = useUser();
  const { data: season } = useSeason();

  const { draft, loaded: draftLoaded } = useDraft();
  const { data: competition } = useCompetition(draft?.competiton_id);

  const sawNotStartedRef = useRef(false);
  const [revealDone, setRevealDone] = useState(false);

  useEffect(() => {
    if (draft?.started === false) {
      sawNotStartedRef.current = true;
    }
  }, [draft?.started]);

  // Remember drafts the user participates in so Home can offer a way back
  // in (see utils/recentDrafts). Finished drafts prune themselves on visit.
  useEffect(() => {
    const userUid = slimUser?.uid;
    if (!draft || !userUid) return;
    if (draft.finished) {
      removeRecentDraft(userUid, draft.id);
      return;
    }
    if (draft.participants.some((p) => p.uid === userUid)) {
      recordRecentDraft(userUid, {
        draftId: draft.id,
        seasonId: draft.season_id,
        seasonNum: draft.season_num,
      });
    } else {
      removeRecentDraft(userUid, draft.id);
    }
  }, [draft, slimUser?.uid]);

  const isRevealing = !!(
    draft?.started &&
    sawNotStartedRef.current &&
    !revealDone
  );

  const handleRevealComplete = useCallback(() => {
    setRevealDone(true);
  }, []);

  const userHasSubmittedPropBets = Boolean(
    draft?.prop_bets?.find((x) => x.user_uid === slimUser?.uid),
  );

  const allPlayersDoneWithPropBets =
    draft?.prop_bets &&
    draft?.prop_bets?.length === draft?.participants?.length;

  const addPropBetsToDraft = async (values: PropBetsFormData) => {
    if (!draft || !slimUser || userHasSubmittedPropBets) return;

    const propBetEntry = {
      id: `propbet_${v4()}`,
      user_uid: slimUser?.uid,
      user_name: slimUser.displayName || slimUser.uid,
      values,
    } satisfies PropBetsEntry;

    try {
      await set(
        ref(rt_db, `drafts/${draft.id}/prop_bets/${slimUser.uid}`),
        propBetEntry,
      );
      trackEvent("prop_bets_submitted", { season_num: draft.season_num });
      notifications.show({
        title: "Prop bets submitted",
        message: "Good luck!",
        color: "green",
        icon: <IconCheck size={16} />,
      });
    } catch (err) {
      notifications.show({
        title: "Failed to submit prop bets",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const createCompetition = async (
    competition_name: string,
    watchAlong: boolean,
  ) => {
    if (!season || !draft) return;

    const competition = {
      id: draft.competiton_id,
      competition_name,
      draft_id: draft.id,
      season_id: season?.id,
      season_num: season?.order,
      creator_uid: draft.creator_uid,
      participant_uids: draft.participants.map((x) => x.uid),
      participants: draft?.participants,
      draft_picks: draft.draft_picks,
      prop_bets: draft.prop_bets,
      finished: false,
      current_episode: watchAlong ? 0 : null,
    } satisfies Competition;

    try {
      await setDoc(doc(db, "competitions", competition.id), competition);
      trackEvent("competition_created", {
        season_num: season.order,
        watch_along: watchAlong,
      });
      notifications.show({
        title: "Competition created!",
        message: competition_name,
        color: "green",
        icon: <IconCheck size={16} />,
      });
    } catch (err) {
      notifications.show({
        title: "Failed to create competition",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const userIsParticipant = useMemo(() => {
    if (!slimUser || !draft?.participants) return false;
    return draft?.participants.some((x) => x.uid === slimUser?.uid);
  }, [draft, slimUser]);

  const { draftId } = useParams();

  const [pendingStateKey, setPendingStateKey] = useState<string | null>(null);

  // Create-if-absent membership write (KTD1): the transaction aborts when a
  // participant record already exists, so double clicks, Strict Mode replays,
  // and cross-tab races converge on one record and one analytics event.
  const joinDraftWithTransaction = useCallback(
    async (
      user: SlimUser,
      id: Draft["id"],
    ): Promise<"joined" | "already-joined" | "failed"> => {
      try {
        const result = await runTransaction(
          ref(rt_db, `drafts/${id}/participants/${user.uid}`),
          (current: SlimUser | null) => (current ? undefined : user),
        );
        if (!result.committed) return "already-joined";
        trackEvent("draft_joined", { season_num: season?.order });
        return "joined";
      } catch {
        return "failed";
      }
    },
    [season?.order],
  );

  const joinDraft = async () => {
    const id = draft?.id ?? draftId;
    if (!id || !slimUser) return;
    const outcome = await joinDraftWithTransaction(slimUser, id as Draft["id"]);
    if (outcome === "failed") {
      notifications.show({
        title: "Failed to join draft",
        message: "Check your connection and try again.",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  // Signed-out invitee: retain the join as a single-use intent, then open
  // account entry. The continuation below executes it exactly once after
  // authentication.
  const handleJoinIntent = (mode: "login" | "register") => {
    const id = (draft?.id ?? draftId) as Draft["id"] | undefined;
    if (!id) return;
    const stateKey = saveAuthIntent({
      kind: "join-draft",
      draftId: id,
      returnPath: `/seasons/${season?.id}/draft/${id}`,
    });
    setPendingStateKey(stateKey);
    modals.openContextModal({
      modal: "AuthModal",
      innerProps: {
        initialMode: mode,
        actionDescription: season
          ? `Join the ${season.name} draft`
          : "Join this draft",
        pendingStateKey: stateKey,
      },
    });
  };

  const executeJoinIntent = useCallback(
    async (intent: AuthIntent) => {
      if (intent.kind !== "join-draft" || !slimUser || !season) {
        return {
          result: "failed" as const,
          message:
            "We couldn't finish joining the draft. Check your connection and try again.",
        };
      }
      const decision = decideJoinContinuation({
        draftExists: draft !== undefined,
        draftStarted: draft?.started === true,
        isParticipant: userIsParticipant,
      });
      switch (decision) {
        case "missing":
          return {
            result: "invalid" as const,
            message: "This draft could not be found. It may have been removed.",
          };
        case "unavailable":
          return {
            result: "invalid" as const,
            message:
              "This draft has already started and can no longer be joined.",
          };
        case "already-joined":
          // Already a member: land in the lobby without another membership
          // write or analytics event.
          return { result: "completed" as const };
        case "join": {
          const outcome = await joinDraftWithTransaction(
            slimUser,
            intent.draftId,
          );
          if (outcome === "failed") {
            return {
              result: "failed" as const,
              message:
                "We couldn't add you to the draft. Check your connection and try again.",
            };
          }
          return { result: "completed" as const };
        }
      }
    },
    [draft, slimUser, season, userIsParticipant, joinDraftWithTransaction],
  );

  const routeDraftId = draft?.id ?? draftId;
  const matchesJoinIntent = useCallback(
    (intent: AuthIntent) =>
      intent.kind === "join-draft" && intent.draftId === routeDraftId,
    [routeDraftId],
  );

  const continuation = useAuthContinuation({
    // Ready once auth and season are known and the draft subscription has
    // delivered its first snapshot — a loaded-but-absent draft must still
    // run the continuation so it classifies as "missing" instead of
    // hanging unclaimed.
    isReady: !!slimUser && !!season && draftLoaded,
    stateKey: pendingStateKey,
    matches: matchesJoinIntent,
    execute: executeJoinIntent,
  });

  // One start write at a time: each call shuffles a fresh order, so a
  // double-click would race two different pick orders.
  const [startingDraft, setStartingDraft] = useState(false);
  const startDraft = async () => {
    if (!draft || !season || !slimUser?.uid || startingDraft) return;
    setStartingDraft(true);

    const draftOrder = shuffle(draft.participants);
    // The draft was created with the whole cast as its pick count. Now that
    // the lobby is final, shrink it to what divides evenly among everyone who
    // joined; the remainder stays undrafted.
    const plan = planDraftPicks(season.players.length, draftOrder.length);
    const turns = buildTurnsMap(draftOrder, plan.totalPicks);

    try {
      await update(ref(rt_db, `drafts/${draft.id}`), {
        pick_order_uids: buildPickOrderUidMap(draftOrder),
        turns,
        total_players: plan.totalPicks,
        "state/started": true,
        // `state/finished` is already false from draft creation, and the RTDB
        // rule for it only allows a false-to-true write, so re-writing false
        // here made the whole multi-path update fail for non-admin creators.
        "state/current_pick_number": 1,
      });
    } catch (err) {
      notifications.show({
        title: "Failed to start draft",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    } finally {
      setStartingDraft(false);
    }
  };

  // One pick write at a time: until the snapshot advances the pick number a
  // second click would write the same pick slot again with a different
  // castaway, so the grid is locked while the update is in flight.
  const [submittingPick, setSubmittingPick] = useState(false);

  const draftPlayer = async (player: {
    castaway_id: CastawayId;
    full_name: string;
  }) => {
    if (!season || !draft || !slimUser?.uid || submittingPick) return;
    setSubmittingPick(true);

    const isFinalPick = draft.current_pick_number >= draft.total_players;
    const nextPickNumber = draft.current_pick_number + 1;

    const draftPick = {
      season_id: season.id,
      season_num: season.order,
      order: draft.current_pick_number,
      user_uid: slimUser.uid,
      user_name: slimUser.displayName || slimUser.email || slimUser.uid,
      castaway_id: player.castaway_id,
      player_name: player.full_name,
    } satisfies Draft["draft_picks"][number];

    try {
      await update(ref(rt_db, `drafts/${draft.id}`), {
        [`draft_picks/${draft.current_pick_number}`]: draftPick,
        "state/current_pick_number": nextPickNumber,
        ...(isFinalPick ? { "state/finished": true } : {}),
      });
      if (isFinalPick) {
        trackEvent("draft_completed", {
          season_num: season.order,
          participant_count: draft.participants.length,
        });
      }
    } catch (err) {
      notifications.show({
        title: "Failed to draft player",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    } finally {
      setSubmittingPick(false);
    }
  };

  useEffect(() => {
    if (
      !draft?.finished ||
      competition ||
      draft.creator_uid !== slimUser?.uid ||
      !allPlayersDoneWithPropBets
    )
      return;

    const onClose = async (values: FormData) => {
      modals.closeAll();
      await createCompetition(values.name, values.watchAlong);
    };

    modals.open({
      title: "What should we call your Competition?",
      closeOnClickOutside: false,
      withCloseButton: false,
      children: <NameYourCompetition onSubmit={onClose} />,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competition, draft, slimUser?.uid]);

  useEffect(() => {
    if (competition) {
      modals.closeAll();
    }
  }, [competition]);

  const isCurrentDrafter =
    draft?.started &&
    !draft.finished &&
    draft.current_picker?.uid === slimUser?.uid;

  const openPlayerDetails = (p: Player) => {
    modals.open({
      withCloseButton: false,
      children: (
        <Stack>
          <Center>
            <Title order={3}>{p.full_name}</Title>
          </Center>
          <Center>
            <Image
              src={p.img}
              alt={p.full_name}
              radius="md"
              fit="cover"
              maw={320}
              style={{
                objectPosition: "center top",
                aspectRatio: "1 / 1",
              }}
            />
          </Center>
          {p.description && (
            <Text ta="center" c="dimmed">
              {p.description.split(" | ").map((x, i) => (
                <span key={i}>
                  {x}
                  <br />
                </span>
              ))}
            </Text>
          )}
        </Stack>
      ),
    });
  };

  const draftLive = !!draft?.started && !draft?.finished;
  useBugContext(
    season ? (
      <>
        <span>S{season.order} · Draft</span>
        {draftLive && (
          <StatusBadge kind="live" size="xs">
            {isCurrentDrafter ? "Your turn" : "Picking"}
          </StatusBadge>
        )}
      </>
    ) : null,
  );

  if (!season) return <div>Error: Missing data</div>;

  // Determine current phase
  const phase = !draft?.started
    ? "pre-draft"
    : isRevealing
      ? "revealing"
      : !draft?.finished
        ? "drafting"
        : !userHasSubmittedPropBets
          ? "prop-bets"
          : "completed";

  const activeStep = phase === "drafting" ? 0 : phase === "prop-bets" ? 1 : 2;

  // Board geometry. Pick order is round-robin over the shuffled order, so
  // columns are the pick order once the draft starts and the join order
  // before. The lobby previews a bounded number of rounds.
  const participants = draft?.participants ?? [];
  const boardColumns = draft?.pick_order?.length
    ? draft.pick_order
    : participants;
  const castCount = season.players?.length ?? 0;
  // Until the host starts, total_players still holds the whole cast, so the
  // lobby previews the split for whoever has joined so far.
  const plan = planDraftPicks(castCount, participants.length);
  const totalPicks = draft?.started
    ? draft.total_players
    : draft
      ? plan.totalPicks
      : castCount;
  const undraftedCount = Math.max(castCount - totalPicks, 0);
  const columnCount = Math.max(boardColumns.length, 1);
  const roundCount = Math.ceil(totalPicks / columnCount);
  // A draft needs two people to start, so a solo lobby has no split to show.
  const picksEach = draft && participants.length >= 2 ? plan.picksEach : null;
  const draftedSummary =
    undraftedCount > 0
      ? `All ${totalPicks} picks are in and ${undraftedCount} ${undraftedCount === 1 ? "castaway" : "castaways"} went undrafted`
      : "Every castaway is drafted";
  const lobbyRounds = Math.min(LOBBY_PREVIEW_ROUNDS, roundCount);
  const currentRound = draft
    ? Math.min(roundCount, Math.ceil(draft.current_pick_number / columnCount))
    : 0;
  const nextPicker =
    draft && draft.current_pick_number < totalPicks
      ? boardColumns[draft.current_pick_number % columnCount]
      : undefined;
  const currentPickerName = draft?.current_picker
    ? participantName(draft.current_picker)
    : "";
  const freshOrder = draft?.draft_picks?.length
    ? draft.draft_picks[draft.draft_picks.length - 1].order
    : undefined;
  const availableCount = castCount - (draft?.draft_picks?.length ?? 0);
  const isCreator = !!draft && draft.creator_uid === slimUser?.uid;

  const sharePlate = (
    <div className={classes.share}>
      <TextInput
        label="Invite link"
        value={window.location.href}
        readOnly
        size="sm"
        onFocus={(event) => event.currentTarget.select()}
      />
      <CopyButton value={window.location.href}>
        {({ copied, copy }) => (
          <Button
            color={copied ? "green" : undefined}
            onClick={copy}
            leftSection={copied ? <IconCheck size={16} /> : undefined}
          >
            {copied ? "Link copied!" : "Copy invite link"}
          </Button>
        )}
      </CopyButton>
    </div>
  );

  return (
    <div className={classes.page}>
      {(continuation.status === "executing" ||
        continuation.status === "failed" ||
        continuation.status === "invalid") && (
        <div className={classes.alerts}>
          {continuation.status === "executing" && (
            <Notice label="Joining" role="status">
              Adding you to the draft...
            </Notice>
          )}
          {continuation.status === "failed" && (
            <Notice
              label="Failed"
              tone="danger"
              role="alert"
              actions={
                <Button
                  size="xs"
                  variant="default"
                  onClick={continuation.retry}
                >
                  Try again
                </Button>
              }
            >
              {continuation.error}
            </Notice>
          )}
          {continuation.status === "invalid" && (
            <Notice
              label="Closed"
              tone="warning"
              role="alert"
              actions={
                <Button
                  size="xs"
                  variant="default"
                  component={Link}
                  to="/competitions"
                >
                  Browse competitions
                </Button>
              }
            >
              This draft can no longer be joined. {continuation.error}
            </Notice>
          )}
        </div>
      )}

      {phase === "pre-draft" ? (
        <>
          {/* ===== LOBBY SPINE: invite (signed out / not yet joined) or the lobby ===== */}
          {!slimUser ? (
            <DraftSpine
              eyebrow={`${season.name} · Draft invite`}
              title="You're invited to this draft!"
              description="Join this draft and start picking players: create a free account or sign in."
              tools={
                <>
                  <Button
                    size="md"
                    onClick={() => handleJoinIntent("register")}
                  >
                    Create account
                  </Button>
                  <Button
                    size="md"
                    variant="outline"
                    color="dark.0"
                    onClick={() => handleJoinIntent("login")}
                  >
                    Sign in
                  </Button>
                </>
              }
            />
          ) : !userIsParticipant ? (
            <DraftSpine
              eyebrow={`${season.name} · Draft invite`}
              title="You're invited to this draft!"
              description="Join now so you're in the pool when the host starts."
              tools={
                <Button size="md" onClick={joinDraft}>
                  Join Draft
                </Button>
              }
              foot={
                draft
                  ? "Columns fill as friends join. Pick order is randomly shuffled when the draft starts. No peeking!"
                  : undefined
              }
            >
              {draft && (
                <DraftBoard
                  columns={participants}
                  rounds={lobbyRounds}
                  totalPicks={totalPicks}
                  picks={[]}
                  players={season.players}
                  viewerUid={slimUser.uid}
                  openColumn
                  numbered={false}
                />
              )}
            </DraftSpine>
          ) : (
            <DraftSpine
              live
              eyebrow={`${season.name} · Lobby open`}
              title="Draft Lobby"
              description="Share the link to invite friends. The host starts the draft once everyone has joined."
              tools={
                <>
                  {sharePlate}
                  {draft && isCreator && (
                    <Button
                      size="md"
                      onClick={startDraft}
                      disabled={draft.participants.length < 2}
                      loading={startingDraft}
                    >
                      {draft.participants.length < 2
                        ? "Waiting for players..."
                        : "Start Draft"}
                    </Button>
                  )}
                  {draft && !isCreator && (
                    <Button size="md" variant="outline" color="dark.0" disabled>
                      Waiting for host to start...
                    </Button>
                  )}
                </>
              }
              foot={`Columns fill as friends join. Pick order is randomly shuffled when the draft starts. No peeking!${
                draft && roundCount > lobbyRounds && participants.length >= 2
                  ? ` Showing ${lobbyRounds} of ${roundCount} rounds.`
                  : ""
              }`}
            >
              {draft && (
                <DraftBoard
                  columns={participants}
                  rounds={lobbyRounds}
                  totalPicks={totalPicks}
                  picks={[]}
                  players={season.players}
                  viewerUid={slimUser.uid}
                  openColumn
                  numbered={false}
                />
              )}
            </DraftSpine>
          )}

          {draft && participants.length >= 2 && undraftedCount > 0 && (
            <Alert color="blue" variant="light" role="status">
              {castCount} castaways don't split evenly among{" "}
              {participants.length} players: everyone drafts {plan.picksEach},
              and{" "}
              {undraftedCount === 1
                ? "1 castaway"
                : `${undraftedCount} castaways`}{" "}
              {undraftedCount === 1 ? "goes" : "go"} undrafted and{" "}
              {undraftedCount === 1 ? "scores" : "score"} for no one.
            </Alert>
          )}

          {draft && (
            <DraftParticipants
              participants={participants}
              creatorUid={draft.creator_uid}
              viewerUid={slimUser?.uid}
              castCount={castCount}
              picksEach={picksEach}
              undraftedCount={undraftedCount}
            />
          )}

          <DraftHowItWorks />
          <DraftScoringReference />
        </>
      ) : phase === "revealing" ? (
        <DraftOrderReveal
          pickOrder={draft!.pick_order}
          onComplete={handleRevealComplete}
          viewerUid={slimUser?.uid}
        />
      ) : phase === "drafting" ? (
        <>
          {/* ===== STEP 0: DRAFT ===== */}
          <DraftSpine
            live
            eyebrow={
              nextPicker
                ? `Round ${currentRound} of ${roundCount} · ${participantName(nextPicker)} picks next`
                : `Round ${currentRound} of ${roundCount} · Final pick`
            }
            title={
              isCurrentDrafter
                ? "Your turn to pick!"
                : `${currentPickerName} is picking...`
            }
            tools={
              draft?.current_picker && (
                <div
                  className={classes.marker}
                  role="status"
                  aria-live="polite"
                >
                  <StatusBadge kind="live" size="md">
                    {isCurrentDrafter
                      ? "Your turn"
                      : `${currentPickerName} picking`}
                  </StatusBadge>
                  <span className={classes.markerMeta}>
                    Pick {draft.current_pick_number} of {draft.total_players} ·
                    Round {currentRound} of {roundCount}
                  </span>
                </div>
              )
            }
          >
            <DraftBoard
              columns={boardColumns}
              rounds={roundCount}
              totalPicks={totalPicks}
              picks={draft!.draft_picks}
              players={season.players}
              currentPickNumber={draft!.current_pick_number}
              currentPickerUid={draft!.current_picker?.uid}
              viewerUid={slimUser?.uid}
              windowed
            />
          </DraftSpine>

          <DraftSteps active={activeStep} />

          <div className={classes.sectionHead}>
            <h2 className={classes.sectionTitle}>
              Cast <span>· {availableCount} available</span>
            </h2>
            <span className={classes.hint}>
              Draft slates are enabled on your turn
            </span>
          </div>

          <DraftCastGrid
            players={season.players}
            picks={draft!.draft_picks}
            viewerUid={slimUser?.uid}
            canDraft={Boolean(
              draft?.started &&
              !draft.finished &&
              isCurrentDrafter &&
              !submittingPick,
            )}
            freshOrder={freshOrder}
            onDraft={draftPlayer}
            onDetails={openPlayerDetails}
            seasonName={season.name}
          />

          <div className={classes.below}>
            {(draft?.draft_picks?.length ?? 0) > 0 ? (
              <DraftTable
                draft_picks={draft!.draft_picks}
                participants={draft!.participants}
                players={season.players}
                totalPicks={totalPicks}
                currentUid={slimUser?.uid}
                freshOrder={freshOrder}
              />
            ) : (
              <div />
            )}
            <DraftScoringReference />
          </div>
        </>
      ) : phase === "prop-bets" ? (
        <>
          {/* ===== STEP 1: PROP BETS ===== */}
          <DraftSpine
            eyebrow={`Draft complete · ${totalPicks} of ${totalPicks} picked`}
            title="Place Your Bets"
            description="Predict what happens this season. Earn bonus points for correct answers."
          />

          <DraftSteps active={activeStep} />

          <Board title="Prop bet questions" titleAs="h2">
            <PropBets season={season} onSubmit={addPropBetsToDraft} />
          </Board>
        </>
      ) : (
        <>
          {/* ===== STEP 2: SUMMARY ===== */}
          <DraftSpine
            eyebrow={`Draft complete · ${draft?.prop_bets?.length || 0} of ${draft?.participants?.length} prop bets in`}
            title="Draft Results"
            description={
              allPlayersDoneWithPropBets
                ? competition
                  ? `${draftedSummary} and every prop bet is in. Your competition is ready.`
                  : `${draftedSummary} and every prop bet is in.`
                : `${draftedSummary}. The competition starts once every prop bet is in.`
            }
            tools={
              allPlayersDoneWithPropBets && competition ? (
                <Button
                  size="md"
                  onClick={() =>
                    navigate(`/competitions/${draft!.competiton_id}`)
                  }
                >
                  Go to your competition
                </Button>
              ) : undefined
            }
          >
            <DraftBoard
              columns={boardColumns}
              rounds={roundCount}
              totalPicks={totalPicks}
              picks={draft!.draft_picks}
              players={season.players}
              viewerUid={slimUser?.uid}
              ariaLabel="Draft results board"
            />
          </DraftSpine>

          <DraftSteps active={activeStep} />

          {!allPlayersDoneWithPropBets && (
            <p
              className={`${classes.notice} ${classes.noticeWarn}`}
              role="status"
            >
              Waiting for prop bets: {draft?.prop_bets?.length || 0} of{" "}
              {draft?.participants?.length} submitted
            </p>
          )}

          {allPlayersDoneWithPropBets && !competition && !isCreator && (
            <p className={classes.notice} role="status">
              Waiting for the host to create the competition.
            </p>
          )}

          {(draft?.prop_bets?.length ?? 0) > 0 && (
            <Board
              title="Prop Bets"
              subtitle={`${draft?.prop_bets?.length || 0} of ${draft?.participants?.length} submitted`}
              titleAs="h2"
              dense
              flush
              scroll
            >
              <PostDraftPropBetTable />
            </Board>
          )}

          <DraftTable
            draft_picks={draft!.draft_picks}
            participants={draft!.participants}
            players={season.players}
            totalPicks={totalPicks}
            currentUid={slimUser?.uid}
          />

          <DraftScoringReference />
        </>
      )}
    </div>
  );
};

type FormData = {
  name: string;
  watchAlong: boolean;
};

type Props = {
  onSubmit: (values: FormData) => void;
};

const NameYourCompetition = ({ onSubmit }: Props) => {
  const form = useForm({
    initialValues: {
      name: "",
      watchAlong: true,
    },
    validate: {
      name: isNotEmpty("Give it a fun name!"),
    },
  });

  return (
    <form
      onSubmit={form.onSubmit((values) => {
        return onSubmit(values);
      })}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          This is how your group will find the competition later.
        </Text>
        <TextInput
          label="Competition name"
          placeholder="e.g., Jeff Probst Fan Club"
          size="md"
          data-autofocus
          {...form.getInputProps("name")}
        />
        <Switch
          label="Watch-along mode"
          description="Reveal episodes one at a time to prevent spoilers. You control when the next episode is revealed."
          {...form.getInputProps("watchAlong", { type: "checkbox" })}
        />
        <Button fullWidth type="submit" size="md">
          Create Competition
        </Button>
      </Stack>
    </form>
  );
};

type PropBetsProps = {
  season: Season;
  onSubmit: (values: PropBetsFormData) => void;
};

const PropBets = ({ season, onSubmit }: PropBetsProps) => {
  const initialValues = useMemo(
    () =>
      PropBetQuestionKeys.reduce<PropBetsFormData>((accum, key) => {
        accum[key] = "";
        return accum;
      }, {}),
    [],
  );

  const validate = useMemo(
    () =>
      PropBetQuestionKeys.reduce<
        Partial<Record<PropBetQuestionKey, ReturnType<typeof isNotEmpty>>>
      >((accum, key) => {
        accum[key] = isNotEmpty("Enter an answer");
        return accum;
      }, {}),
    [],
  );

  const form = useForm<PropBetsFormData>({
    initialValues,
    validate,
  });

  const playerOptions = season.players.map((player) => ({
    value: player.castaway_id,
    label: player.full_name,
  }));

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement> | undefined,
  ) => {
    e?.preventDefault();

    const _validate = form.validate();

    if (_validate.hasErrors) return;

    onSubmit(form.values);
  };

  const answered = PropBetQuestionKeys.filter((key) =>
    Boolean(form.values[key]),
  ).length;

  return (
    <form onSubmit={handleSubmit}>
      <div className={classes.formGrid}>
        {PropBetQuestionKeys.map((key) => {
          const question = PropBetsQuestions[key];
          return (
            <Select
              key={key}
              required
              label={question.description}
              description={question.point_value + " points"}
              placeholder="Pick one"
              data={
                question.answer_type === "boolean"
                  ? ["Yes", "No"]
                  : playerOptions
              }
              {...form.getInputProps(key)}
            />
          );
        })}
      </div>
      <div className={classes.formActions}>
        <Button type="submit" size="md">
          Submit Prop Bets
        </Button>
        <span className={classes.formCount}>
          {answered} of {PropBetQuestionKeys.length} answered
        </span>
      </div>
    </form>
  );
};

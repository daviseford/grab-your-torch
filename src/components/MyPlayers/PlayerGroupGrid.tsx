import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconArrowsExchange, IconPencil } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useEvents } from "../../hooks/useEvents";
import { useUser } from "../../hooks/useUser";
import { CastawayId, Competition, Player, SlimUser } from "../../types";
import { getParticipantName } from "../../utils/misc";
import { TEAM_NAME_MAX_LENGTH, updateTeamName } from "../../utils/teamNames";
import {
  Acquisition,
  getAcquisitionLabel,
  getUpcomingMoveLabel,
  UpcomingMove,
} from "../../utils/tradeUtils";
import { StatusBadge } from "../Layout";
import classes from "./PlayerGroupGrid.module.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

export const PlayerGroupGrid = () => {
  const { data: competition } = useCompetition();
  const { slimUser } = useUser();

  const {
    survivorsByUserUid,
    eliminatedSurvivors,
    drafters,
    acquisitions,
    upcomingMoves,
    incomingByUserUid,
  } = useCompetitionMeta();
  const { data: events } = useEvents(competition?.season_id);

  const isFinished = competition?.finished ?? false;

  const winnerCastawayId = useMemo(() => {
    if (!isFinished) return null;
    return (
      Object.values(events).find((e) => e.action === "win_survivor")
        ?.castaway_id ?? null
    );
  }, [isFinished, events]);

  // Draft order is history, not ownership: it labels a pick on the drafter's
  // roster and is replaced by the via-trade mark once the castaway moves.
  const draftOrders = useMemo(
    () =>
      Object.fromEntries(
        (competition?.draft_picks ?? []).map((pick) => [
          pick.castaway_id,
          pick.order,
        ]),
      ) as Partial<Record<CastawayId, number>>,
    [competition?.draft_picks],
  );

  if (!competition) return null;

  return (
    <div className={classes.groups}>
      {competition.participants.map((x) => (
        <TeamCard
          key={x.uid}
          participant={x}
          userSurvivors={survivorsByUserUid[x.uid] ?? []}
          eliminatedSurvivors={eliminatedSurvivors}
          participants={competition.participants}
          teamNames={competition.team_names}
          competitionId={competition.id}
          // Only the team's owner or an admin may rename it; the creator
          // has no say over other participants' names (see firestore.rules).
          canEditTeamName={slimUser?.uid === x.uid || !!slimUser?.isAdmin}
          drafters={drafters}
          draftOrders={draftOrders}
          acquisitions={acquisitions}
          upcomingMoves={upcomingMoves}
          incoming={incomingByUserUid[x.uid] ?? []}
          winnerCastawayId={winnerCastawayId}
          isFinished={isFinished}
        />
      ))}
    </div>
  );
};

const RosterCastaway = ({
  player,
  alt,
  out = false,
  leaving = false,
  arriving = false,
  meta,
}: {
  player: Player;
  alt: string;
  out?: boolean;
  leaving?: boolean;
  arriving?: boolean;
  meta: React.ReactNode;
}) => {
  const rootClass = [
    classes.castaway,
    out && classes.castawayOut,
    leaving && classes.castawayLeaving,
    arriving && classes.castawayArriving,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rootClass}>
      {player.img ? (
        <img
          src={player.img}
          alt={alt}
          width={44}
          height={56}
          loading="lazy"
          decoding="async"
          className={classes.portrait}
        />
      ) : (
        <span className={classes.portraitInitials} role="img" aria-label={alt}>
          {initials(player.full_name)}
        </span>
      )}
      <div className={classes.castawayBody}>
        <div className={classes.castawayName} title={player.full_name}>
          {player.full_name}
        </div>
        <div className={classes.castawayMeta}>{meta}</div>
      </div>
    </div>
  );
};

const TeamCard = ({
  participant,
  userSurvivors,
  eliminatedSurvivors,
  participants,
  teamNames,
  competitionId,
  canEditTeamName,
  drafters,
  draftOrders,
  acquisitions,
  upcomingMoves,
  incoming,
  winnerCastawayId,
  isFinished,
}: {
  participant: SlimUser;
  userSurvivors: Player[];
  eliminatedSurvivors: CastawayId[];
  participants: SlimUser[];
  teamNames: Competition["team_names"];
  competitionId: Competition["id"];
  canEditTeamName: boolean;
  drafters: Record<CastawayId, string>;
  draftOrders: Partial<Record<CastawayId, number>>;
  acquisitions: Record<CastawayId, Acquisition>;
  upcomingMoves: Record<CastawayId, UpcomingMove>;
  incoming: { player: Player; fromUid: string; landsNextEpisode: boolean }[];
  winnerCastawayId: CastawayId | null;
  isFinished: boolean;
}) => {
  // Everything on this card is about the roster as of the episode the
  // competition is on: a trade whose cutoff has not been revealed yet keeps
  // the castaway here, marked as leaving, with a preview on the receiving
  // card.
  const numOnRoster = userSurvivors.length;
  const numEliminated = userSurvivors.filter((s) =>
    eliminatedSurvivors.includes(s.castaway_id),
  ).length;
  const numActive = numOnRoster - numEliminated;
  const numAcquired = userSurvivors.filter(
    (s) => acquisitions[s.castaway_id],
  ).length;
  const outgoingMoves = userSurvivors
    .map((s) => upcomingMoves[s.castaway_id])
    .filter(Boolean);
  const numMoving = outgoingMoves.length + incoming.length;
  const allMovesLandNext =
    outgoingMoves.every((m) => m.landsNextEpisode) &&
    incoming.every((i) => i.landsNextEpisode);

  const areAllEliminated = numOnRoster > 0 && numEliminated === numOnRoster;
  const ownsWinner =
    winnerCastawayId != null &&
    userSurvivors.some((s) => s.castaway_id === winnerCastawayId);

  const saveTeamName = async (name: string) => {
    try {
      await updateTeamName(competitionId, participant.uid, name);
    } catch (err) {
      notifications.show({
        title: "Failed to update team name",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  };

  const openTeamNameEditor = () => {
    modals.open({
      title: "Edit team name",
      children: (
        <TeamNameModal
          currentName={teamNames?.[participant.uid] ?? ""}
          fallbackName={
            participant.displayName || participant.email || "Unknown"
          }
          onConfirm={saveTeamName}
        />
      ),
    });
  };

  const displayName = getParticipantName(
    participants,
    participant.uid,
    teamNames,
  );

  return (
    <Card
      padding={0}
      radius="md"
      withBorder
      className={classes.group}
      style={{
        opacity: areAllEliminated && !isFinished ? 0.6 : 1,
      }}
    >
      <div className={classes.groupHead}>
        <div className={classes.groupTitle}>
          <Title order={4} className={classes.groupName}>
            {displayName}
          </Title>
          <span className={classes.groupSub}>
            {numOnRoster} on roster
            {numAcquired > 0 ? ` · ${numAcquired} via trade` : ""} ·{" "}
            {numEliminated} eliminated
            {numMoving > 0
              ? allMovesLandNext
                ? " · trade lands next episode"
                : " · trade pending"
              : ""}
          </span>
        </div>
        <div className={classes.groupAside}>
          {canEditTeamName && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={openTeamNameEditor}
              aria-label={`Edit team name for ${
                participant.displayName || participant.email
              }`}
            >
              <IconPencil size={14} />
            </ActionIcon>
          )}
          {isFinished ? (
            ownsWinner ? (
              <span className={classes.winnerTag}>Sole Survivor</span>
            ) : (
              <StatusBadge kind="complete" size="sm">
                Season over
              </StatusBadge>
            )
          ) : areAllEliminated ? (
            <Badge variant="outline" color="red" size="sm">
              {numActive} active
            </Badge>
          ) : (
            <StatusBadge kind="in-progress" size="sm">
              {numActive} active
            </StatusBadge>
          )}
        </div>
      </div>

      {(userSurvivors.length > 0 || incoming.length > 0) && (
        <div className={classes.cast}>
          {userSurvivors.map((p) => {
            const isEliminated = eliminatedSurvivors.includes(p.castaway_id);
            const isWinner = p.castaway_id === winnerCastawayId;
            const acquisition = acquisitions[p.castaway_id];
            const acquisitionLabel = acquisition
              ? getAcquisitionLabel(
                  acquisition,
                  drafters[p.castaway_id],
                  participants,
                  teamNames,
                )
              : null;
            const upcomingMove = upcomingMoves[p.castaway_id];
            const upcomingLabel = upcomingMove
              ? getUpcomingMoveLabel(upcomingMove, participants, teamNames)
              : null;
            const draftOrder = draftOrders[p.castaway_id];

            return (
              <RosterCastaway
                key={p.castaway_id}
                player={p}
                alt={
                  upcomingMove ? `${p.full_name} (trading away)` : p.full_name
                }
                out={isEliminated && !isWinner}
                leaving={!!upcomingMove}
                meta={
                  <>
                    {isWinner ? (
                      <span className={classes.winnerTag}>Sole Survivor</span>
                    ) : isEliminated ? (
                      <span>Eliminated</span>
                    ) : acquisitionLabel ? (
                      <>
                        <Tooltip label={acquisitionLabel}>
                          <span
                            className={classes.tradeMark}
                            role="img"
                            aria-label={acquisitionLabel}
                          >
                            <IconArrowsExchange size={10} stroke={2.5} />
                          </span>
                        </Tooltip>
                        <span>Via trade</span>
                      </>
                    ) : draftOrder != null ? (
                      <span>Pick {draftOrder}</span>
                    ) : (
                      <span>Drafted</span>
                    )}
                    {acquisitionLabel && (isEliminated || isWinner) && (
                      <Tooltip label={acquisitionLabel}>
                        <span
                          className={classes.tradeMark}
                          role="img"
                          aria-label={acquisitionLabel}
                        >
                          <IconArrowsExchange size={10} stroke={2.5} />
                        </span>
                      </Tooltip>
                    )}
                    {upcomingLabel && upcomingMove && (
                      <Tooltip label={upcomingLabel}>
                        <Badge
                          size="xs"
                          variant="outline"
                          color="yellow"
                          role="img"
                          aria-label={upcomingLabel}
                        >
                          →{" "}
                          {getParticipantName(
                            participants,
                            upcomingMove.toUid,
                            teamNames,
                          )}
                        </Badge>
                      </Tooltip>
                    )}
                  </>
                }
              />
            );
          })}
          {incoming.map(({ player, fromUid, landsNextEpisode }) => {
            const timing = landsNextEpisode
              ? "next episode"
              : "in an upcoming episode";
            const label = getUpcomingMoveLabel(
              { fromUid, toUid: participant.uid, landsNextEpisode },
              participants,
              teamNames,
            );
            return (
              <RosterCastaway
                key={`incoming_${player.castaway_id}`}
                player={player}
                alt={`${player.full_name} (arriving ${timing})`}
                arriving
                meta={
                  <>
                    <span>
                      {landsNextEpisode
                        ? "Arriving next episode"
                        : "Arriving soon"}
                    </span>
                    <Tooltip label={label}>
                      <Badge
                        size="xs"
                        variant="outline"
                        color="yellow"
                        role="img"
                        aria-label={label}
                      >
                        from{" "}
                        {getParticipantName(participants, fromUid, teamNames)}
                      </Badge>
                    </Tooltip>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </Card>
  );
};

const TeamNameModal = ({
  currentName,
  fallbackName,
  onConfirm,
}: {
  currentName: string;
  fallbackName: string;
  onConfirm: (name: string) => void;
}) => {
  const [name, setName] = useState(currentName);

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Set a team name for this competition only. Leave it blank to use your
        account name.
      </Text>
      <TextInput
        label="Team name"
        placeholder={fallbackName}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        maxLength={TEAM_NAME_MAX_LENGTH}
        data-autofocus
      />
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={() => modals.closeAll()}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            modals.closeAll();
            onConfirm(name);
          }}
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
};

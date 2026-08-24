import {
  ActionIcon,
  Button,
  Group,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil } from "@tabler/icons-react";
import { sum } from "lodash-es";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useScoringCalculations } from "../../hooks/useScoringCalculations";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import {
  CastawayId,
  Competition,
  Elimination,
  Player,
  SlimUser,
  Trade,
} from "../../types";
import { getNumberWithOrdinal, getParticipantName } from "../../utils/misc";
import { TEAM_NAME_MAX_LENGTH, updateTeamName } from "../../utils/teamNames";
import {
  Acquisition,
  getAcquisitionLabel,
  getOwnedCastawaysAtEpisode,
  getUpcomingMoveLabel,
  UpcomingMove,
} from "../../utils/tradeUtils";
import { Board, StatusBadge } from "../Layout";
import classes from "./MyTeamSection.module.css";

const TRADES_TAB_LINK = "?tab=trades";

const getEliminationLabel = (elimination: Elimination): string => {
  const episode = `Ep ${elimination.episode_num}`;
  switch (elimination.variant) {
    case "tribal":
      return `Voted out, ${episode}`;
    case "medical":
      return `Medevac, ${episode}`;
    case "quitter":
      return `Quit, ${episode}`;
    case "ejected":
      return `Ejected, ${episode}`;
    case "final_tribal_council":
      return `Final tribal, ${episode}`;
    default:
      return `Out, ${episode}`;
  }
};

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

type RosterRow = {
  player: Player;
  /** Points scored while on this team, matching the Standings table. */
  points: number;
  lastEpisodePoints: number;
  elimination?: Elimination;
  isWinner: boolean;
  draftOrder?: number;
  acquisition?: Acquisition;
  upcomingMove?: UpcomingMove;
};

const TeamNameEditor = ({
  initialName,
  fallbackName,
  onSave,
  onCancel,
}: {
  initialName: string;
  fallbackName: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={classes.nameForm} onSubmit={submit}>
      <TextInput
        className={classes.nameInput}
        aria-label="Team name"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        placeholder={fallbackName}
        maxLength={TEAM_NAME_MAX_LENGTH}
        description="Shown to everyone in this competition. Leave blank to use your account name."
        inputWrapperOrder={["label", "input", "description", "error"]}
        size="md"
        autoFocus
        disabled={saving}
      />
      <Group gap="xs" wrap="nowrap">
        <Button type="submit" size="md" loading={saving}>
          Save
        </Button>
        <Button
          type="button"
          size="md"
          variant="default"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </Group>
    </form>
  );
};

export const MyTeamSection = ({ trades }: { trades: Trade[] }) => {
  const { slimUser } = useUser();
  const { data: competition } = useCompetition();
  const { data: season } = useSeason(competition?.season_id);
  const {
    survivorsByUserUid,
    eliminatedSurvivors,
    drafters,
    acquisitions,
    upcomingMoves,
    incomingByUserUid,
  } = useCompetitionMeta();
  const {
    activePropBetKeys,
    filteredEpisodes,
    filteredEliminations,
    filteredEvents,
    survivorPointsByEpisode,
    pointsByUserPerEpisodeWithPropBets,
  } = useScoringCalculations();

  const [editingName, setEditingName] = useState(false);

  const uid = slimUser?.uid;
  const incoming = (uid ? incomingByUserUid[uid] : undefined) ?? [];
  const lastEpisode = filteredEpisodes[filteredEpisodes.length - 1];

  const winnerCastawayId = useMemo(
    () =>
      Object.values(filteredEvents).find((e) => e.action === "win_survivor")
        ?.castaway_id ?? null,
    [filteredEvents],
  );

  const rows = useMemo<RosterRow[]>(() => {
    if (!competition || !uid) return [];
    const roster = survivorsByUserUid[uid] ?? [];

    const ownedByEpisode = filteredEpisodes.map(
      (episode) =>
        new Set<CastawayId>(
          getOwnedCastawaysAtEpisode(
            competition.draft_picks,
            trades,
            uid,
            episode.order,
          ),
        ),
    );

    const pointsFor = (castawayId: CastawayId) =>
      sum(
        filteredEpisodes.map((episode, index) =>
          ownedByEpisode[index].has(castawayId)
            ? (survivorPointsByEpisode[castawayId]?.[episode.order - 1]
                ?.total ?? 0)
            : 0,
        ),
      );

    const eliminationsByCastaway = new Map<CastawayId, Elimination>();
    for (const elimination of Object.values(filteredEliminations)) {
      if (elimination.variant === "switched") continue;
      eliminationsByCastaway.set(elimination.castaway_id, elimination);
    }

    return roster
      .map<RosterRow>((player) => {
        const id = player.castaway_id;
        const isEliminated = eliminatedSurvivors.includes(id);
        return {
          player,
          points: pointsFor(id),
          lastEpisodePoints: lastEpisode
            ? (survivorPointsByEpisode[id]?.[lastEpisode.order - 1]?.total ?? 0)
            : 0,
          elimination: isEliminated
            ? eliminationsByCastaway.get(id)
            : undefined,
          isWinner: winnerCastawayId === id,
          draftOrder: competition.draft_picks.find((p) => p.castaway_id === id)
            ?.order,
          acquisition: acquisitions[id],
          upcomingMove: upcomingMoves[id],
        };
      })
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const aOut = a.elimination ? 1 : 0;
        const bOut = b.elimination ? 1 : 0;
        if (aOut !== bOut) return aOut - bOut;
        return a.player.full_name.localeCompare(b.player.full_name);
      });
  }, [
    acquisitions,
    competition,
    eliminatedSurvivors,
    filteredEliminations,
    filteredEpisodes,
    lastEpisode,
    survivorsByUserUid,
    survivorPointsByEpisode,
    trades,
    uid,
    upcomingMoves,
    winnerCastawayId,
  ]);

  if (!competition || !season || !slimUser || !uid) return null;

  const participants = competition.participants;
  const teamNames = competition.team_names;
  const accountName = slimUser.displayName || slimUser.email || "your account";
  const customName = teamNames?.[uid] ?? "";
  const displayName = getParticipantName(participants, uid, teamNames);

  const saveName = async (name: string) => {
    const trimmed = name.trim();
    if (trimmed === customName) {
      setEditingName(false);
      return;
    }
    try {
      await updateTeamName(competition.id, uid, trimmed);
      notifications.show({
        color: "green",
        message: trimmed
          ? `Your team is now "${trimmed}".`
          : `Team name cleared. You'll appear as ${accountName}.`,
      });
      setEditingName(false);
    } catch (err) {
      notifications.show({
        color: "red",
        title: "Couldn't rename your team",
        message:
          err instanceof Error
            ? err.message
            : "Check your connection and try again.",
      });
    }
  };

  // Standing, from the same totals the Standings table ranks by.
  const standings = Object.entries(pointsByUserPerEpisodeWithPropBets);
  const mine = pointsByUserPerEpisodeWithPropBets[uid];
  const myTotal = mine?.total ?? 0;
  const hasStandings = filteredEpisodes.length > 0 && standings.length > 0;
  const rank = 1 + standings.filter(([, v]) => v.total > myTotal).length;
  const leaderTotal = Math.max(...standings.map(([, v]) => v.total));
  const leaders = standings
    .filter(([, v]) => v.total === leaderTotal)
    .map(([leaderUid]) => leaderUid);
  const isLeader = hasStandings && leaders.includes(uid);
  const runnerUpTotal = Math.max(
    ...standings
      .filter(([otherUid]) => otherUid !== uid)
      .map(([, v]) => v.total),
    -Infinity,
  );

  const nameOf = (otherUid: string) =>
    getParticipantName(participants, otherUid, teamNames);

  let standingDetail: string;
  if (!hasStandings) {
    standingDetail = "Standings open after Episode 1.";
  } else if (isLeader && leaders.length > 1) {
    const others = leaders.filter((l) => l !== uid).map(nameOf);
    standingDetail = `Tied for 1st with ${others.join(", ")}`;
  } else if (isLeader) {
    standingDetail =
      runnerUpTotal === -Infinity
        ? "Leading the competition"
        : `Leading by ${plural(myTotal - runnerUpTotal, "pt")}`;
  } else {
    standingDetail = `${plural(leaderTotal - myTotal, "pt")} behind ${
      leaders.length > 1 ? "the leaders" : nameOf(leaders[0])
    }`;
  }

  // Highlights
  const topScorer = rows.find((row) => row.points > 0);
  const episodePoints = mine?.episodePoints ?? [];
  const bestEpisodeIndex = episodePoints.reduce(
    (best, value, index) => (value > episodePoints[best] ? index : best),
    0,
  );
  const bestEpisode =
    episodePoints.length > 0 && episodePoints[bestEpisodeIndex] > 0
      ? {
          episode: filteredEpisodes[bestEpisodeIndex],
          points: episodePoints[bestEpisodeIndex],
        }
      : null;
  const activeCount = rows.filter((row) => !row.elimination).length;
  const tradedInCount = rows.filter((row) => row.acquisition).length;

  // Trades involving this team
  const myTrades = trades.filter(
    (trade) => trade.offered_by_uid === uid || trade.offered_to_uid === uid,
  );
  const incomingOffers = myTrades.filter(
    (trade) => trade.status === "pending" && trade.offered_to_uid === uid,
  ).length;
  const outgoingOffers = myTrades.filter(
    (trade) => trade.status === "pending" && trade.offered_by_uid === uid,
  ).length;
  const completedTrades = myTrades.filter(
    (trade) => trade.status === "accepted",
  ).length;

  return (
    <div className={classes.root}>
      <header className={classes.header}>
        <div className={classes.identity}>
          {editingName ? (
            <TeamNameEditor
              initialName={customName}
              fallbackName={accountName}
              onSave={saveName}
              onCancel={() => setEditingName(false)}
            />
          ) : (
            <>
              <Group gap={6} align="center" wrap="nowrap">
                <Title order={3} className={classes.teamName}>
                  {displayName}
                </Title>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="md"
                  onClick={() => setEditingName(true)}
                  aria-label="Rename team"
                >
                  <IconPencil size={16} />
                </ActionIcon>
              </Group>
              <Text size="sm" c="dimmed">
                {customName
                  ? `Playing as ${accountName}`
                  : "Using your account name. Rename your team to make it yours."}
              </Text>
            </>
          )}
        </div>

        <div className={classes.standing}>
          {hasStandings ? (
            <div className={classes.rankRow}>
              {isLeader && <span className={classes.leading}>Leading</span>}
              <span className={classes.standingRank}>
                {getNumberWithOrdinal(rank)}
              </span>
              <span className={classes.standingOf}>
                of {participants.length}
              </span>
            </div>
          ) : (
            <span className={`${classes.standingRank} ${classes.dim}`}>—</span>
          )}
          <div className={classes.standingPts}>
            {plural(myTotal, "pt")}
            {activePropBetKeys.length > 0 && mine?.propBetPoints ? (
              <span> · {mine.propBetPoints} from prop bets</span>
            ) : null}
          </div>
          <div className={classes.standingDetail}>{standingDetail}</div>
        </div>
      </header>

      <Board
        title="Roster"
        titleAs="h4"
        subtitle={
          rows.length > 0
            ? `${plural(rows.length, "castaway")} · ${activeCount} still in the game`
            : undefined
        }
        dense
        flush
      >
        {rows.length === 0 && incoming.length === 0 ? (
          <p className={classes.note}>No castaways on your roster yet.</p>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="xs" horizontalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Castaway</Table.Th>
                  <Table.Th scope="col">Status</Table.Th>
                  <Table.Th scope="col">Acquired</Table.Th>
                  <Table.Th scope="col" ta="right">
                    {lastEpisode ? `Ep ${lastEpisode.order}` : "Latest"}
                  </Table.Th>
                  <Table.Th scope="col" ta="right">
                    Points
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row) => (
                  <RosterTableRow
                    key={row.player.castaway_id}
                    row={row}
                    participants={participants}
                    teamNames={teamNames}
                    drafterUid={drafters[row.player.castaway_id]}
                    hasEpisodes={!!lastEpisode}
                  />
                ))}
                {incoming.map(({ player, fromUid, landsNextEpisode }) => (
                  <Table.Tr
                    key={`incoming_${player.castaway_id}`}
                    className={classes.arriving}
                  >
                    <Table.Td>
                      <div className={classes.castawayCell}>
                        <Portrait
                          player={player}
                          className={classes.faceArriving}
                        />
                        <span className={classes.castawayName}>
                          {player.full_name}
                        </span>
                      </div>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge kind="pending" size="sm">
                        {landsNextEpisode
                          ? "Arriving next episode"
                          : "Arriving soon"}
                      </StatusBadge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">From {nameOf(fromUid)}</Text>
                    </Table.Td>
                    <Table.Td className={`${classes.numeric} ${classes.dim}`}>
                      —
                    </Table.Td>
                    <Table.Td className={`${classes.numeric} ${classes.dim}`}>
                      —
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {rows.length > 0 && (
          <p className={classes.footnote}>
            Points count only while a castaway is on your roster, the same way
            the Standings table scores trades.
          </p>
        )}
      </Board>

      <div className={classes.insights}>
        <Board title="Highlights" titleAs="h4">
          {!hasStandings ? (
            <Text size="sm" c="dimmed">
              Highlights appear once Episode 1 has been scored.
            </Text>
          ) : (
            <dl className={classes.statList}>
              <dt>Top scorer</dt>
              <dd>
                {topScorer
                  ? `${topScorer.player.full_name} · ${plural(topScorer.points, "pt")}`
                  : "No points yet"}
              </dd>
              <dt>Best episode</dt>
              <dd>
                {bestEpisode
                  ? `Ep ${bestEpisode.episode.order} · ${plural(bestEpisode.points, "pt")}`
                  : "No points yet"}
              </dd>
              <dt>Still in the game</dt>
              <dd>
                {activeCount} of {rows.length}
              </dd>
              {tradedInCount > 0 && (
                <>
                  <dt>Acquired by trade</dt>
                  <dd>{tradedInCount}</dd>
                </>
              )}
            </dl>
          )}
        </Board>

        <Board title="Trades" titleAs="h4">
          {myTrades.length === 0 ? (
            <div className={classes.stack}>
              <Text size="sm" c="dimmed">
                {competition.finished
                  ? "You didn't trade this season."
                  : "You haven't traded yet."}
              </Text>
              {!competition.finished && (
                <Button
                  component={Link}
                  to={TRADES_TAB_LINK}
                  variant="default"
                  size="xs"
                >
                  Open trades
                </Button>
              )}
            </div>
          ) : (
            <div className={classes.stack}>
              <dl className={classes.statList}>
                {incomingOffers > 0 && (
                  <>
                    <dt>Waiting on you</dt>
                    <dd>{plural(incomingOffers, "offer")}</dd>
                  </>
                )}
                {outgoingOffers > 0 && (
                  <>
                    <dt>Waiting on others</dt>
                    <dd>{plural(outgoingOffers, "offer")}</dd>
                  </>
                )}
                <dt>Completed</dt>
                <dd>{plural(completedTrades, "trade")}</dd>
              </dl>
              <Button
                component={Link}
                to={TRADES_TAB_LINK}
                variant={incomingOffers > 0 ? "filled" : "default"}
                size="xs"
              >
                {incomingOffers > 0 ? "Review offers" : "Open trades"}
              </Button>
            </div>
          )}
        </Board>
      </div>
    </div>
  );
};

const Portrait = ({
  player,
  className,
}: {
  player: Player;
  className?: string;
}) =>
  player.img ? (
    <img
      src={player.img}
      alt=""
      width={26}
      height={32}
      loading="lazy"
      decoding="async"
      className={`${classes.face} ${className ?? ""}`}
    />
  ) : (
    <span
      className={`${classes.facePlaceholder} ${className ?? ""}`}
      aria-hidden="true"
    >
      {initials(player.full_name)}
    </span>
  );

const RosterTableRow = ({
  row,
  participants,
  teamNames,
  drafterUid,
  hasEpisodes,
}: {
  row: RosterRow;
  participants: SlimUser[];
  teamNames: Competition["team_names"];
  drafterUid: string | undefined;
  hasEpisodes: boolean;
}) => {
  const { player, elimination, isWinner, acquisition, upcomingMove } = row;
  const isEliminated = !!elimination;
  const isOut = isEliminated && !isWinner;

  const acquisitionLabel = acquisition
    ? getAcquisitionLabel(acquisition, drafterUid, participants, teamNames)
    : null;
  const upcomingLabel = upcomingMove
    ? getUpcomingMoveLabel(upcomingMove, participants, teamNames)
    : null;

  return (
    <Table.Tr className={isOut ? classes.eliminated : undefined}>
      <Table.Td>
        <div className={classes.castawayCell}>
          <Portrait
            player={player}
            className={isOut ? classes.faceOut : undefined}
          />
          <span
            className={`${classes.castawayName} ${isOut ? classes.struck : ""}`}
          >
            {player.full_name}
          </span>
          {upcomingMove && upcomingLabel && (
            <Tooltip label={upcomingLabel}>
              <Text
                size="xs"
                c="dimmed"
                span
                role="img"
                aria-label={upcomingLabel}
                style={{ flexShrink: 0 }}
              >
                Goes to{" "}
                {getParticipantName(
                  participants,
                  upcomingMove.toUid,
                  teamNames,
                )}{" "}
                {upcomingMove.landsNextEpisode ? "next episode" : "soon"}
              </Text>
            </Tooltip>
          )}
        </div>
      </Table.Td>
      <Table.Td>
        {isWinner ? (
          <span className={classes.winnerTag}>Sole Survivor</span>
        ) : elimination ? (
          <Text size="sm">{getEliminationLabel(elimination)}</Text>
        ) : (
          <StatusBadge kind="in-progress" size="sm">
            Active
          </StatusBadge>
        )}
      </Table.Td>
      <Table.Td>
        {acquisition && acquisitionLabel ? (
          <Tooltip label={acquisitionLabel}>
            <Text size="sm" style={{ cursor: "default" }}>
              From{" "}
              {getParticipantName(participants, acquisition.fromUid, teamNames)}
            </Text>
          </Tooltip>
        ) : (
          <Text size="sm">
            {row.draftOrder != null ? `Pick ${row.draftOrder}` : "Drafted"}
          </Text>
        )}
      </Table.Td>
      <Table.Td
        className={`${classes.numeric} ${!hasEpisodes || row.lastEpisodePoints === 0 ? classes.dim : ""}`}
      >
        {hasEpisodes ? row.lastEpisodePoints : "—"}
      </Table.Td>
      <Table.Td
        className={`${classes.numeric} ${classes.total} ${row.points === 0 ? classes.dim : ""}`}
      >
        {row.points}
      </Table.Td>
    </Table.Tr>
  );
};

import {
  Alert,
  Button,
  Center,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconLock } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useChallenges } from "../../hooks/useChallenges";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useEliminations } from "../../hooks/useEliminations";
import { useEvents } from "../../hooks/useEvents";
import { useSeason } from "../../hooks/useSeason";
import {
  acceptTrade,
  cancelTrade,
  rejectTrade,
} from "../../hooks/useTradeActions";
import { useUser } from "../../hooks/useUser";
import { Trade } from "../../types";
import { getParticipantName } from "../../utils/misc";
import { getTradeLockEpisode } from "../../utils/tradeUtils";
import { EmptySlate, StatusBadge } from "../Layout";
import { ProposeTradeModal } from "./ProposeTradeModal";
import { TradeOffer, TradeStatusBadge } from "./TradeOffer";
import { getPlayers } from "./tradePlayers";
import styles from "./TradesSection.module.css";

const HISTORY_BATCH_SIZE = 5;

const resolvedAt = (trade: Trade): string =>
  typeof trade.resolved_at === "string" ? trade.resolved_at : trade.created_at;

const GroupHead = ({
  title,
  count,
  muted = false,
  aside,
}: {
  title: string;
  count?: number;
  muted?: boolean;
  aside?: React.ReactNode;
}) => (
  <div className={styles.groupHead}>
    <div className={styles.groupTitle}>
      <Title order={4}>{title}</Title>
      {count != null && (
        <span
          className={`${styles.count} ${muted ? styles.countMuted : ""}`}
          aria-label={`${count} ${count === 1 ? "offer" : "offers"}`}
        >
          {count}
        </span>
      )}
    </div>
    {aside}
  </div>
);

type TradesSectionProps = {
  trades: Trade[];
  tradesLoaded: boolean;
  tradesError: Error | null;
};

export const TradesSection = ({
  trades,
  tradesLoaded,
  tradesError,
}: TradesSectionProps) => {
  const { slimUser } = useUser();
  const { data: competition } = useCompetition();
  const { data: season } = useSeason(competition?.season_id);
  // The propose modal works with tradable rosters (every accepted trade
  // applied), not display rosters: a player already promised away in a trade
  // that cuts over next episode cannot be offered again.
  const { tradableSurvivorsByUserUid, eliminatedSurvivors } =
    useCompetitionMeta();

  const { data: challenges, isReady: areChallengesReady } = useChallenges(
    competition?.season_id,
  );
  const { data: eliminations, isReady: areEliminationsReady } = useEliminations(
    competition?.season_id,
  );
  const { data: events, isReady: areEventsReady } = useEvents(
    competition?.season_id,
  );

  // acceptTrade derives the points cutoff from these three records. Accepting
  // before they arrive would compute a cutoff of episode 1 and hand over every
  // point already scored -- and the cutoff can never be corrected afterwards,
  // because firestore.rules only allows updates while status is "pending".
  const isScoringDataReady =
    areChallengesReady && areEliminationsReady && areEventsReady;

  const [modalOpen, setModalOpen] = useState(false);
  const [resolvingTradeId, setResolvingTradeId] = useState<string | null>(null);
  const [historyVisibility, setHistoryVisibility] = useState({
    competitionId: competition?.id,
    count: HISTORY_BATCH_SIZE,
  });

  const visibleHistoryCount =
    historyVisibility.competitionId === competition?.id
      ? historyVisibility.count
      : HISTORY_BATCH_SIZE;
  const myUid = slimUser?.uid;

  const { incoming, outgoing, history } = useMemo(() => {
    const pending = trades.filter((trade) => trade.status === "pending");

    return {
      incoming: pending.filter((trade) => trade.offered_to_uid === myUid),
      outgoing: pending.filter((trade) => trade.offered_by_uid === myUid),
      history: trades
        .filter((trade) => trade.status !== "pending")
        .sort((a, b) => resolvedAt(b).localeCompare(resolvedAt(a))),
    };
  }, [myUid, trades]);
  const visibleHistory = useMemo(
    () => history.slice(0, visibleHistoryCount),
    [history, visibleHistoryCount],
  );
  const remainingHistoryCount = history.length - visibleHistory.length;

  if (!competition || !season) return null;

  const isParticipant = !!myUid && competition.participant_uids.includes(myUid);

  const lockEpisode = getTradeLockEpisode(season, competition.current_episode);
  const tradingClosed = competition.finished || !!lockEpisode;

  const resolveTrade = async (
    tradeId: string,
    action: () => Promise<unknown>,
  ) => {
    setResolvingTradeId(tradeId);
    try {
      await action();
    } finally {
      setResolvingTradeId(null);
    }
  };

  // The pending subtitles describe an action still open ("review", "waiting"),
  // so resolved trades get a status-appropriate line instead.
  const subtitleFor = (trade: Trade, pendingCopy: string): string => {
    if (trade.status === "accepted") return "Completed trade";
    if (trade.status === "rejected") return "Offer declined";
    if (trade.status === "canceled") return "Offer withdrawn";
    return pendingCopy;
  };

  const perspective = (trade: Trade) => {
    const offeredPlayers = getPlayers(
      season.players,
      trade.offered_castaway_ids,
    );
    const requestedPlayers = getPlayers(
      season.players,
      trade.requested_castaway_ids,
    );
    const offeredBy = getParticipantName(
      competition.participants,
      trade.offered_by_uid,
      competition.team_names,
    );
    const offeredTo = getParticipantName(
      competition.participants,
      trade.offered_to_uid,
      competition.team_names,
    );

    if (trade.offered_to_uid === myUid) {
      return {
        title: `Offer from ${offeredBy}`,
        subtitle: subtitleFor(trade, "Review what changes hands"),
        leftLabel: "You receive",
        leftPlayers: offeredPlayers,
        rightLabel: "You send",
        rightPlayers: requestedPlayers,
      };
    }

    if (trade.offered_by_uid === myUid) {
      return {
        title: `Offer to ${offeredTo}`,
        subtitle: subtitleFor(trade, "Waiting for their response"),
        leftLabel: "You send",
        leftPlayers: offeredPlayers,
        rightLabel: "You receive",
        rightPlayers: requestedPlayers,
      };
    }

    return {
      title: `${offeredBy} and ${offeredTo}`,
      subtitle: subtitleFor(trade, "Trade between participants"),
      leftLabel: `${offeredBy} sends`,
      leftPlayers: offeredPlayers,
      rightLabel: `${offeredTo} sends`,
      rightPlayers: requestedPlayers,
    };
  };

  return (
    <Stack gap="lg">
      {lockEpisode && !competition.finished && (
        <Alert
          variant="outline"
          color="orange"
          icon={<IconLock size={18} />}
          title="Trades are locked"
        >
          Episode {lockEpisode.order} airs today. Trading reopens tomorrow.
        </Alert>
      )}

      {tradesError && (
        <Alert
          variant="outline"
          color="red"
          icon={<IconAlertCircle size={18} />}
          title="Trade activity is unavailable"
          role="alert"
        >
          Refresh the page to reconnect before proposing or responding to a
          trade.
        </Alert>
      )}

      {isParticipant && !competition.finished && (
        <div className={styles.toolbar}>
          <Button
            onClick={() => setModalOpen(true)}
            disabled={tradingClosed || !tradesLoaded || !!tradesError}
          >
            Propose trade
          </Button>
        </div>
      )}

      {incoming.length > 0 && (
        <Stack gap="sm">
          <GroupHead title="Incoming offers" count={incoming.length} />
          {incoming.map((trade) => {
            const view = perspective(trade);
            const isResolving = resolvingTradeId === trade.id;

            return (
              <TradeOffer
                key={trade.id}
                trade={trade}
                {...view}
                status={
                  <StatusBadge kind="live" size="sm">
                    Your move
                  </StatusBadge>
                }
                actions={
                  <>
                    <Button
                      variant="subtle"
                      color="red"
                      disabled={isResolving}
                      onClick={() =>
                        resolveTrade(trade.id, () => rejectTrade(trade))
                      }
                    >
                      Decline
                    </Button>
                    <Button
                      disabled={
                        tradingClosed ||
                        (competition.current_episode === null &&
                          !isScoringDataReady)
                      }
                      loading={isResolving}
                      onClick={() =>
                        resolveTrade(trade.id, () =>
                          acceptTrade({
                            isScoringDataReady,
                            trade,
                            competition,
                            season,
                            existingTrades: trades,
                            eliminatedCastawayIds: eliminatedSurvivors,
                            challenges,
                            eliminations,
                            events,
                          }),
                        )
                      }
                    >
                      Accept offer
                    </Button>
                  </>
                }
              />
            );
          })}
        </Stack>
      )}

      {outgoing.length > 0 && (
        <Stack gap="sm">
          <GroupHead title="Sent offers" count={outgoing.length} muted />
          {outgoing.map((trade) => {
            const view = perspective(trade);
            const isResolving = resolvingTradeId === trade.id;

            return (
              <TradeOffer
                key={trade.id}
                trade={trade}
                {...view}
                status={
                  <TradeStatusBadge
                    trade={trade}
                    currentEpisode={competition.current_episode}
                  />
                }
                actions={
                  <Button
                    variant="subtle"
                    color="gray"
                    loading={isResolving}
                    onClick={() =>
                      resolveTrade(trade.id, () => cancelTrade(trade))
                    }
                  >
                    Withdraw offer
                  </Button>
                }
              />
            );
          })}
        </Stack>
      )}

      {!tradesLoaded && !tradesError && (
        <Center py="xl" role="status" aria-live="polite">
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading trade activity
            </Text>
          </Stack>
        </Center>
      )}

      {tradesLoaded && history.length > 0 && (
        <Stack gap="sm">
          <GroupHead
            title="Trade history"
            aside={
              <span className={styles.historyCount} aria-live="polite">
                Showing {visibleHistory.length} of {history.length}
              </span>
            }
          />
          {visibleHistory.map((trade) => (
            <TradeOffer
              key={trade.id}
              trade={trade}
              {...perspective(trade)}
              status={
                <TradeStatusBadge
                  trade={trade}
                  currentEpisode={competition.current_episode}
                />
              }
            />
          ))}
          {remainingHistoryCount > 0 && (
            <Button
              variant="default"
              size="md"
              fullWidth
              onClick={() =>
                setHistoryVisibility((current) => ({
                  competitionId: competition.id,
                  count:
                    (current.competitionId === competition.id
                      ? current.count
                      : HISTORY_BATCH_SIZE) + HISTORY_BATCH_SIZE,
                }))
              }
            >
              Load {Math.min(HISTORY_BATCH_SIZE, remainingHistoryCount)} more
            </Button>
          )}
        </Stack>
      )}

      {tradesLoaded && trades.length === 0 && (
        <EmptySlate title="No trade activity yet">
          Propose a swap when you spot a deal that helps both teams.
        </EmptySlate>
      )}

      {myUid && !tradesError && (
        <ProposeTradeModal
          opened={modalOpen}
          onClose={() => setModalOpen(false)}
          competition={competition}
          season={season}
          existingTrades={trades}
          eliminatedCastawayIds={eliminatedSurvivors}
          myUid={myUid}
          myPlayers={tradableSurvivorsByUserUid[myUid] ?? []}
          playersByUid={tradableSurvivorsByUserUid}
        />
      )}
    </Stack>
  );
};

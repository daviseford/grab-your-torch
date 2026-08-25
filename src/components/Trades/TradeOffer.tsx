import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import { IconArrowsExchange } from "@tabler/icons-react";
import { Trade } from "../../types";
import { StatusBadge } from "../Layout";
import { TradePlayer } from "./tradePlayers";
import styles from "./TradesSection.module.css";

/**
 * Presentational pieces of a trade offer, shared between the live trades
 * section and the marketing example on the home page.
 */

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

export const TradeStatusBadge = ({
  trade,
  currentEpisode,
}: {
  trade: Trade;
  /** null means the competition is not episode-limited, so nothing is hidden. */
  currentEpisode: number | null;
}) => {
  if (trade.status === "accepted") {
    // A cutoff is normally the next episode to be revealed, which is safe to
    // name. Trades accepted before the cutoff was tied to `current_episode`
    // carry the season's latest *data* episode instead, which would reveal how
    // far the season has progressed -- hide anything beyond the next reveal.
    const cutoff = trade.effective_episode;
    const showCutoff =
      typeof cutoff === "number" &&
      (currentEpisode === null || cutoff <= currentEpisode + 1);
    return (
      <Badge color="green" variant="filled" size="sm">
        {showCutoff ? `Accepted · from Ep ${cutoff}` : "Accepted"}
      </Badge>
    );
  }
  if (trade.status === "rejected")
    return (
      <Badge color="red" variant="outline" size="sm">
        Declined
      </Badge>
    );
  if (trade.status === "canceled")
    return (
      <Badge color="gray" variant="outline" size="sm">
        Canceled
      </Badge>
    );
  return <StatusBadge kind="pending" size="sm" />;
};

export const PlayerList = ({ players }: { players: TradePlayer[] }) => (
  <Stack gap={6}>
    {players.map((player) => (
      <div key={player.castaway_id} className={styles.playerRow}>
        {player.img ? (
          <img
            src={player.img}
            alt=""
            width={30}
            height={38}
            loading="lazy"
            decoding="async"
            className={styles.face}
          />
        ) : (
          <span className={styles.facePlaceholder} aria-hidden="true">
            {initials(player.full_name)}
          </span>
        )}
        <span className={styles.playerName}>{player.full_name}</span>
      </div>
    ))}
  </Stack>
);

export const Exchange = ({
  leftLabel,
  leftPlayers,
  rightLabel,
  rightPlayers,
}: {
  leftLabel: string;
  leftPlayers: TradePlayer[];
  rightLabel: string;
  rightPlayers: TradePlayer[];
}) => (
  <div className={styles.exchange}>
    <Box className={styles.exchangeSide}>
      <Text className={styles.exchangeLabel}>{leftLabel}</Text>
      <PlayerList players={leftPlayers} />
    </Box>
    <div className={styles.exchangeArrow} aria-hidden="true">
      <IconArrowsExchange size={18} />
    </div>
    <Box className={styles.exchangeSide}>
      <Text className={styles.exchangeLabel}>{rightLabel}</Text>
      <PlayerList players={rightPlayers} />
    </Box>
  </div>
);

export const TradeOffer = ({
  trade,
  title,
  subtitle,
  leftLabel,
  leftPlayers,
  rightLabel,
  rightPlayers,
  status,
  actions,
}: {
  trade: Trade;
  title: string;
  subtitle: string;
  leftLabel: string;
  leftPlayers: TradePlayer[];
  rightLabel: string;
  rightPlayers: TradePlayer[];
  status?: React.ReactNode;
  actions?: React.ReactNode;
}) => (
  <Box className={styles.offer} data-trade-id={trade.id}>
    <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
      <div>
        <Text className={styles.offerTitle}>{title}</Text>
        <Text size="xs" c="dimmed">
          {subtitle}
        </Text>
      </div>
      {status}
    </Group>

    <Exchange
      leftLabel={leftLabel}
      leftPlayers={leftPlayers}
      rightLabel={rightLabel}
      rightPlayers={rightPlayers}
    />

    {actions && <div className={styles.offerActions}>{actions}</div>}
  </Box>
);

import { Button } from "@mantine/core";
import { SEASON_47_PLAYERS } from "../../data/season_47";
import type { Trade } from "../../types";
import { StatusBadge } from "../Layout";
import { TradeOffer, TradeStatusBadge } from "../Trades/TradeOffer";
import { getPlayers } from "../Trades/tradePlayers";
import classes from "./Home.module.css";

/**
 * The trades panel exactly as a competition page renders it, on fictional
 * offers of the Survivor 47 cast. The viewer is Jordan -- the participant on
 * the clock in the draft example above -- with one incoming offer awaiting
 * their call and one sent offer still pending. Buttons are inert.
 */
const VIEWER_UID = "example-jordan";

const INCOMING: Trade = {
  id: "trade_example_incoming",
  competition_id: "competition_example",
  season_id: "season_47",
  offered_by_uid: "example-priya",
  offered_to_uid: VIEWER_UID,
  offered_castaway_ids: [SEASON_47_PLAYERS[3].castaway_id],
  requested_castaway_ids: [SEASON_47_PLAYERS[2].castaway_id],
  status: "pending",
  created_at: "2024-10-16T18:24:00.000Z",
};

const OUTGOING: Trade = {
  id: "trade_example_outgoing",
  competition_id: "competition_example",
  season_id: "season_47",
  offered_by_uid: VIEWER_UID,
  offered_to_uid: "example-theo",
  offered_castaway_ids: [SEASON_47_PLAYERS[6].castaway_id],
  requested_castaway_ids: [SEASON_47_PLAYERS[5].castaway_id],
  status: "pending",
  created_at: "2024-10-15T09:02:00.000Z",
};

export const HomeTradeExample = () => (
  <figure className={`${classes.example} ${classes.exampleNarrow}`}>
    <TradeOffer
      trade={INCOMING}
      title="Offer from Priya"
      subtitle="Review what changes hands"
      leftLabel="You receive"
      leftPlayers={getPlayers(SEASON_47_PLAYERS, INCOMING.offered_castaway_ids)}
      rightLabel="You send"
      rightPlayers={getPlayers(
        SEASON_47_PLAYERS,
        INCOMING.requested_castaway_ids,
      )}
      status={
        <StatusBadge kind="live" size="sm">
          Your move
        </StatusBadge>
      }
      actions={
        <>
          <Button variant="subtle" color="red">
            Decline
          </Button>
          <Button>Accept offer</Button>
        </>
      }
    />
    <TradeOffer
      trade={OUTGOING}
      title="Offer to Theo"
      subtitle="Waiting for their response"
      leftLabel="You send"
      leftPlayers={getPlayers(SEASON_47_PLAYERS, OUTGOING.offered_castaway_ids)}
      rightLabel="You receive"
      rightPlayers={getPlayers(
        SEASON_47_PLAYERS,
        OUTGOING.requested_castaway_ids,
      )}
      status={<TradeStatusBadge trade={OUTGOING} currentEpisode={4} />}
      actions={
        <Button variant="subtle" color="gray">
          Withdraw offer
        </Button>
      }
    />
  </figure>
);

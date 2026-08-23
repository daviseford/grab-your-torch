import { Table } from "@mantine/core";
import { DraftPick, Player, SlimUser } from "../../types";
import { getNumberWithOrdinal } from "../../utils/misc";
import { Board } from "../Layout";
import classes from "./DraftTable.module.css";

type DraftTableProps = {
  draft_picks: DraftPick[];
  participants: SlimUser[];
  players: Player[];
  /** Total picks in the draft, for the "n of total" qualifier. */
  totalPicks?: number;
  /** The viewer, whose picks carry the cyan bar. */
  currentUid?: string;
  /** The pick just made, underlined in Ember while the draft is live. */
  freshOrder?: number;
};

const initialOf = (name: string) =>
  (name.trim().charAt(0) || "?").toUpperCase();

/** Draft results in pick order, as a dense board. */
export const DraftTable = ({
  draft_picks,
  participants,
  players,
  totalPicks,
  currentUid,
  freshOrder,
}: DraftTableProps) => {
  const rows = (draft_picks ?? []).map((x) => {
    const player = players?.find((p) => p.castaway_id === x.castaway_id);
    const user = participants?.find((p) => p.uid === x.user_uid);
    const rowClass = [
      x.user_uid === currentUid && classes.me,
      x.order === freshOrder && classes.fresh,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <Table.Tr key={x.castaway_id} className={rowClass || undefined}>
        <Table.Td className={classes.pick}>
          {getNumberWithOrdinal(x.order)}
        </Table.Td>
        <Table.Td>
          <span className={classes.contestant}>
            {player?.img ? (
              <img
                className={classes.thumb}
                src={player.img}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className={classes.thumb} aria-hidden="true">
                {initialOf(x.player_name)}
              </span>
            )}
            {x.player_name}
          </span>
        </Table.Td>
        <Table.Td>{user?.displayName || user?.email || x.user_name}</Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Board
      title="Draft Results"
      subtitle={
        totalPicks !== undefined
          ? `${draft_picks?.length ?? 0} of ${totalPicks}`
          : undefined
      }
      titleAs="h2"
      dense
      flush
      scroll
    >
      <Table highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={64}>Pick</Table.Th>
            <Table.Th>Contestant</Table.Th>
            <Table.Th>Drafted By</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </Board>
  );
};

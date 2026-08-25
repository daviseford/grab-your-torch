import { CastawayId, Player } from "../../types";

/** The player fields the trade offer panels render. */
export type TradePlayer = Pick<Player, "castaway_id" | "full_name" | "img">;

export const getPlayers = (
  players: Player[] | undefined,
  ids: CastawayId[],
): TradePlayer[] =>
  ids.map(
    (id) =>
      players?.find((player) => player.castaway_id === id) ?? {
        castaway_id: id,
        full_name: id,
        img: "",
      },
  );

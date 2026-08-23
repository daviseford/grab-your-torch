import { SimpleGrid } from "@mantine/core";
import type { ReactNode } from "react";
import { CastawayCard } from "../components/Layout";
import { useSeason } from "../hooks/useSeason";
import { Player } from "../types";

/** Age and hometown on one line, profession on the next, where present. */
const castawayMeta = (player: Player): ReactNode => {
  const line = [player.age, player.hometown].filter(Boolean).join(" · ");
  if (!line && !player.profession) return undefined;
  return (
    <>
      {line && <span>{line}</span>}
      {line && player.profession && <br />}
      {player.profession && <span>{player.profession}</span>}
    </>
  );
};

export const Players = () => {
  const { data: season } = useSeason();

  if (!season) return null;

  return (
    <SimpleGrid
      cols={{ base: 2, sm: 3, md: 6 }}
      spacing={{ base: "sm", sm: "md" }}
    >
      {season.players.map((player) => (
        <CastawayCard
          key={player.castaway_id}
          name={player.full_name}
          img={player.img}
          meta={castawayMeta(player)}
        />
      ))}
    </SimpleGrid>
  );
};

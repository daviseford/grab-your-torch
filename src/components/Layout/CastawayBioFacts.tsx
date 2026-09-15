import { Anchor, Group, Stack, Text } from "@mantine/core";
import type { Player } from "../../types";
import { getCastawayBio } from "../../utils/castawayBio";
import classes from "./CastawayBioFacts.module.css";

/** Preseason facts only: never render freeform season bios or career results here. */
export const CastawayBioFacts = ({ player }: { player: Player }) => {
  const bio = getCastawayBio(player);
  const facts = [
    ["Age this season", player.age],
    ["Occupation", player.profession],
    ["Gender", bio.gender],
    ["Hometown", bio.hometown],
    ["Residence at filming", bio.residence],
    ["Birthplace", bio.birthplace],
    ["Height", bio.height],
    ["Weight", bio.weight],
  ];

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Preseason profile · Season {player.season_num}
      </Text>
      <dl className={classes.facts}>
        {facts
          .filter(([, value]) => value !== undefined && value !== "")
          .map(([label, value]) => (
            <div key={label} className={classes.fact}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      <div>
        <Text fw={600} size="sm">
          Hobbies & interests
        </Text>
        <Text size="sm" mt={4}>
          {bio.hobbies ?? "Not published in our sources"}
        </Text>
      </div>
      {bio.sources && (
        <Group gap="xs">
          {bio.sources.map((source) => (
            <Anchor
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
            >
              {source.label}
            </Anchor>
          ))}
        </Group>
      )}
    </Stack>
  );
};

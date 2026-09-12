import { Anchor, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useRef, useState } from "react";
import type { Player } from "../../types";
import { getCastawayBio } from "../../utils/castawayBio";
import classes from "./CastawayBioButton.module.css";

/** Preseason facts only: never render freeform season bios or career results here. */
export const CastawayBioButton = ({ player }: { player: Player }) => {
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
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
    <>
      <Button
        ref={trigger}
        variant="subtle"
        size="compact-xs"
        onClick={() => setOpened(true)}
        aria-label={`View bio for ${player.full_name}`}
        aria-haspopup="dialog"
      >
        Bio
      </Button>
      {opened && (
        <Modal
          opened
          returnFocus={false}
          onClose={() => {
            setOpened(false);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
          title={`About ${player.full_name}`}
          size="md"
          centered
        >
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
        </Modal>
      )}
    </>
  );
};

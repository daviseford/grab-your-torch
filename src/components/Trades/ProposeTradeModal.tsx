import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { proposeTrade } from "../../hooks/useTradeActions";
import {
  CastawayId,
  Competition,
  Player,
  Season,
  SlimUser,
  Trade,
} from "../../types";
import styles from "./ProposeTradeModal.module.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

export const ProposeTradeModal = ({
  opened,
  onClose,
  competition,
  season,
  existingTrades,
  eliminatedCastawayIds,
  myUid,
  myPlayers,
  playersByUid,
}: {
  opened: boolean;
  onClose: () => void;
  competition: Competition;
  season: Season;
  existingTrades: Trade[];
  eliminatedCastawayIds: CastawayId[];
  myUid: string;
  myPlayers: Player[];
  playersByUid: Record<string, Player[]>;
}) => {
  const [partnerUid, setPartnerUid] = useState<string | null>(null);
  const [mySelection, setMySelection] = useState<CastawayId[]>([]);
  const [theirSelection, setTheirSelection] = useState<CastawayId[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const partners = competition.participants.filter(
    (participant) => participant.uid !== myUid,
  );
  const alive = (players: Player[]) =>
    players.filter(
      (player) => !eliminatedCastawayIds.includes(player.castaway_id),
    );

  const activeMyPlayers = alive(myPlayers);
  const partnerPlayers = partnerUid
    ? alive(playersByUid[partnerUid] ?? [])
    : [];
  const partner = partners.find(
    (participant) => participant.uid === partnerUid,
  );

  const reset = () => {
    setPartnerUid(null);
    setMySelection([]);
    setTheirSelection([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const toggle = (
    id: CastawayId,
    selection: CastawayId[],
    setSelection: (ids: CastawayId[]) => void,
  ) =>
    setSelection(
      selection.includes(id)
        ? selection.filter((selectedId) => selectedId !== id)
        : [...selection, id],
    );

  const canSubmit =
    partnerUid !== null && mySelection.length > 0 && theirSelection.length > 0;

  const submit = async () => {
    if (!partnerUid) return;
    setSubmitting(true);
    const ok = await proposeTrade({
      competition,
      season,
      existingTrades,
      eliminatedCastawayIds,
      offeredByUid: myUid,
      offeredToUid: partnerUid,
      offeredCastawayIds: mySelection,
      requestedCastawayIds: theirSelection,
    });
    setSubmitting(false);
    if (ok) close();
  };

  const playerCheckbox = (
    player: Player,
    selection: CastawayId[],
    setSelection: (ids: CastawayId[]) => void,
  ) => {
    const checked = selection.includes(player.castaway_id);

    return (
      <Checkbox
        key={player.castaway_id}
        className={styles.playerOption}
        data-checked={checked || undefined}
        label={
          <Group gap="sm" wrap="nowrap">
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
            <Text size="sm" fw={600} lh={1.25}>
              {player.full_name}
            </Text>
          </Group>
        }
        checked={checked}
        onChange={() => toggle(player.castaway_id, selection, setSelection)}
      />
    );
  };

  const selectionSummary = canSubmit
    ? `${mySelection.length} ${mySelection.length === 1 ? "player" : "players"} for ${theirSelection.length} ${theirSelection.length === 1 ? "player" : "players"}`
    : "Choose at least one player from each team";

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={
        <div>
          <Title order={3}>Propose a trade</Title>
          <Text size="sm" c="dimmed" fw={400}>
            Build an offer for another participant
          </Text>
        </div>
      }
      centered
      size="lg"
    >
      <Stack gap="lg">
        <Select
          label="Trade with"
          placeholder="Choose a participant"
          description="Select whose roster you want to browse"
          data={partners.map((participant: SlimUser) => ({
            value: participant.uid,
            label:
              competition.team_names?.[participant.uid] ||
              participant.displayName ||
              participant.email ||
              participant.uid,
          }))}
          value={partnerUid}
          onChange={(value) => {
            setPartnerUid(value);
            setTheirSelection([]);
          }}
          size="md"
          allowDeselect={false}
        />

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Box className={styles.selectionPanel}>
            <Group justify="space-between" mb="sm">
              <div>
                <Text className={styles.panelTitle}>You send</Text>
                <Text size="xs" c="dimmed">
                  From your active roster
                </Text>
              </div>
              <Badge
                variant={mySelection.length > 0 ? "filled" : "outline"}
                color={mySelection.length > 0 ? "league" : "gray"}
              >
                {mySelection.length} selected
              </Badge>
            </Group>
            <Stack gap="xs" className={styles.rosterList}>
              {activeMyPlayers.map((player) =>
                playerCheckbox(player, mySelection, setMySelection),
              )}
              {activeMyPlayers.length === 0 && (
                <Text size="sm" c="dimmed" py="md">
                  You have no active players to trade.
                </Text>
              )}
            </Stack>
          </Box>

          <Box className={styles.selectionPanel}>
            <Group justify="space-between" mb="sm">
              <div>
                <Text className={styles.panelTitle}>You receive</Text>
                <Text size="xs" c="dimmed">
                  {partner
                    ? `From ${
                        competition.team_names?.[partner.uid] ||
                        partner.displayName ||
                        partner.email
                      }`
                    : "Choose a partner first"}
                </Text>
              </div>
              <Badge
                variant={theirSelection.length > 0 ? "filled" : "outline"}
                color={theirSelection.length > 0 ? "league" : "gray"}
              >
                {theirSelection.length} selected
              </Badge>
            </Group>
            <Stack gap="xs" className={styles.rosterList}>
              {!partnerUid && (
                <Box className={styles.placeholder}>
                  <Text size="sm" c="dimmed" ta="center">
                    Select a participant to see their active roster.
                  </Text>
                </Box>
              )}
              {partnerPlayers.map((player) =>
                playerCheckbox(player, theirSelection, setTheirSelection),
              )}
              {partnerUid && partnerPlayers.length === 0 && (
                <Text size="sm" c="dimmed" py="md">
                  This participant has no active players to trade.
                </Text>
              )}
            </Stack>
          </Box>
        </SimpleGrid>

        <Group justify="space-between" align="center" className={styles.footer}>
          <Text size="sm" c={canSubmit ? undefined : "dimmed"} fw={500}>
            {selectionSummary}
          </Text>
          <Group gap="xs">
            <Button variant="subtle" color="gray" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canSubmit} loading={submitting}>
              Send offer
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};

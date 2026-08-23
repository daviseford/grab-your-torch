import { Button, Group, Select, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { doc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "../../firebase";
import { Competition, Season } from "../../types";
import { StatusBadge } from "../Layout";
import classes from "./EpisodeAdvanceControl.module.css";

type Props = {
  competition: Competition;
  season: Season;
  isCreator: boolean;
  hasWinner: boolean;
};

const EpisodePickerModal = ({
  season,
  onConfirm,
}: {
  season: Season;
  onConfirm: (episode: number) => void;
}) => {
  const [selected, setSelected] = useState<string>("0");

  const episodeOptions = [
    { value: "0", label: "No episodes revealed" },
    ...(season.episodes ?? []).map((e) => ({
      value: String(e.order),
      label: `Episode ${e.order}: ${e.name}`,
    })),
  ];

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Choose which episode you&apos;re up to. Episodes after this will be
        hidden to prevent spoilers.
      </Text>
      <Select
        label="Current episode"
        data={episodeOptions}
        value={selected}
        onChange={(v) => setSelected(v ?? "0")}
        allowDeselect={false}
      />
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={() => modals.closeAll()}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            modals.closeAll();
            onConfirm(Number(selected));
          }}
        >
          Switch to Watch-Along
        </Button>
      </Group>
    </Stack>
  );
};

/**
 * The creator's episode boundary controls, rendered beside the reveal strip
 * in the competition header. Everyone else reads the boundary from the strip
 * and the header meta, so the control renders nothing for them.
 */
export const EpisodeAdvanceControl = ({
  competition,
  season,
  isCreator,
  hasWinner,
}: Props) => {
  const currentEpisode = competition.current_episode;
  const totalEpisodes = season.episodes?.length ?? 0;

  if (!isCreator) return null;

  const updateEpisode = async (newValue: number | null) => {
    try {
      await updateDoc(doc(db, "competitions", competition.id), {
        current_episode: newValue,
      });
    } catch (err) {
      notifications.show({
        title: "Failed to update episode",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    }
  };

  // Live mode — creator view
  if (currentEpisode == null) {
    const openEpisodePicker = () => {
      modals.open({
        title: "Switch to Watch-Along",
        children: (
          <EpisodePickerModal season={season} onConfirm={updateEpisode} />
        ),
      });
    };

    return (
      <div className={classes.root}>
        <div className={classes.actions}>
          <Button variant="default" size="sm" onClick={openEpisodePicker}>
            Switch to Watch-Along
          </Button>
        </div>
      </div>
    );
  }

  // Watch-Along mode
  const canAdvance = currentEpisode < totalEpisodes;
  const canGoBack = currentEpisode > 0;

  const advanceEpisode = () => {
    updateEpisode(Math.min(totalEpisodes, currentEpisode + 1));
  };

  const goBackEpisode = () => {
    modals.openConfirmModal({
      title: "Go back one episode?",
      children: (
        <Text size="sm">
          Participants may have already seen Episode {currentEpisode}
          &apos;s results. Going back will hide them again.
        </Text>
      ),
      labels: { confirm: "Go Back", cancel: "Cancel" },
      confirmProps: { color: "orange" },
      onConfirm: () => {
        updateEpisode(Math.max(0, currentEpisode - 1));
      },
    });
  };

  const switchToLive = () => {
    const willAutoFinish = hasWinner && !competition.finished;
    const warningText = willAutoFinish
      ? `This will reveal all ${totalEpisodes} episodes including results. This competition will be automatically marked as complete because the season has ended. This cannot be undone.`
      : `This will reveal all ${totalEpisodes} episodes including results. Are you sure?`;

    modals.openConfirmModal({
      title: "Switch to Live?",
      children: <Text size="sm">{warningText}</Text>,
      labels: { confirm: "Reveal All Episodes", cancel: "Cancel" },
      confirmProps: { color: "orange" },
      onConfirm: () => {
        updateEpisode(null);
      },
    });
  };

  return (
    <div className={classes.root}>
      <div className={classes.actions}>
        {canAdvance ? (
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            onClick={switchToLive}
            className={classes.switchModeAction}
          >
            Switch to Live
          </Button>
        ) : (
          <StatusBadge
            kind={hasWinner ? "complete" : "in-progress"}
            size="sm"
            className={classes.completionBadge}
          >
            {hasWinner ? "Season Complete" : "Up to Date"}
          </StatusBadge>
        )}
        <Button
          variant="default"
          size="sm"
          leftSection={<IconChevronLeft size={14} />}
          disabled={!canGoBack}
          onClick={goBackEpisode}
        >
          Back
        </Button>
        {canAdvance && (
          <Button
            variant="filled"
            size="sm"
            rightSection={<IconChevronRight size={14} />}
            onClick={advanceEpisode}
          >
            {currentEpisode === 0
              ? "Reveal Ep 1"
              : `Reveal Ep ${currentEpisode + 1}`}
          </Button>
        )}
      </div>
    </div>
  );
};

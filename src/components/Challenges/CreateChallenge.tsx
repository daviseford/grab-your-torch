import {
  Alert,
  Button,
  MultiSelect,
  NumberInput,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, setDoc } from "firebase/firestore";
import { last, orderBy } from "lodash-es";
import { useEffect } from "react";
import { v4 } from "uuid";
import { db } from "../../firebase";
import { useChallenges } from "../../hooks/useChallenges";
import { useEliminations } from "../../hooks/useEliminations";
import { useSeason } from "../../hooks/useSeason";
import { useTeamAssignments } from "../../hooks/useTeamAssignments";
import { useTeams } from "../../hooks/useTeams";
import {
  CreatePanel,
  FormActions,
  FormRow,
  FormStack,
  LoadingRow,
  PanelAside,
} from "../../pages/SeasonAdminParts";
import { Challenge, ChallengeWinActions, Team } from "../../types";
import { getPlayersOnTeam } from "../../utils/teamUtils";
import { EmptySlate } from "../Layout";

export const CreateChallenge = () => {
  const { data: season, isLoading } = useSeason();
  const { data: eliminations } = useEliminations(season?.id);
  const { data: challenges } = useChallenges(season?.id);
  const { data: teams } = useTeams(season?.id);
  const { data: teamAssignments } = useTeamAssignments(season?.id);

  const form = useForm<Challenge>({
    initialValues: {
      id: `challenge_${v4()}`,
      season_num: 1,
      season_id: "season_1",
      episode_id: "episode_1",
      episode_num: 1,
      variant: ChallengeWinActions[0],
      winning_castaways: [],
      order: 0,
    },

    validate: {
      winning_castaways: hasLength({ min: 1 }, "Add winning player(s)"),
    },

    transformValues: (values) => ({
      ...values,
      episode_id: `episode_${values.episode_num}`,
      season_id: `season_${values.season_num}`,
    }),
  });

  // Set initial values with async request
  useEffect(() => {
    if (season && challenges) {
      const order = (last(orderBy(challenges, (x) => x.order))?.order || 0) + 1;
      const episode_num = season.episodes.length;

      form.setValues({
        season_num: season.order,
        season_id: season.id,
        episode_num: episode_num,
        episode_id: `episode_${episode_num}`,
        order,
      });
      form.resetDirty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, challenges]);

  // Recompute winning_players when episode changes while a winning team is selected
  const currentEpisodeNum = form.values.episode_num;
  const currentWinningTeamId = form.values.winning_team_id;
  useEffect(() => {
    if (!currentWinningTeamId) return;

    const episodeSnapshot = teamAssignments[String(currentEpisodeNum)] ?? {};
    const hasSnapshot = Object.keys(episodeSnapshot).length > 0;

    if (hasSnapshot) {
      const playersOnTeam = getPlayersOnTeam(
        episodeSnapshot,
        currentWinningTeamId,
      );
      form.setFieldValue("winning_castaways", playersOnTeam);
    } else {
      // No snapshot for this episode -- clear team selection and winners
      form.setFieldValue("winning_team_id", null);
      form.setFieldValue("winning_castaways", []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEpisodeNum]);

  if (isLoading) {
    return <LoadingRow label="Loading season" />;
  }

  if (!season?.episodes?.length) {
    return <EmptySlate title="Create an Episode first before adding events" />;
  }

  const handleSubmit = async (values: Challenge) => {
    const _validate = form.validate();

    if (_validate.hasErrors) return;

    try {
      const ref = doc(db, `challenges/${season?.id}`);
      await setDoc(ref, { [values.id]: values }, { merge: true });

      notifications.show({
        title: "Challenge created successfully",
        message: `${values.variant} challenge added`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      // reset id and important form values
      form.setValues({
        id: `challenge_${v4()}`,
        winning_castaways: [],
        winning_team_id: null,
      });
    } catch (err) {
      notifications.show({
        title: "Failed to create challenge",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const teamList = Object.values(teams || {});
  const teamSelectData = teamList.map((t) => ({
    value: t.id,
    label: t.name,
  }));
  const hasEpisodeSnapshot = Boolean(
    teamAssignments[String(form.values.episode_num)],
  );

  const handleWinningTeamChange = (teamId: string | null) => {
    if (!teamId) {
      form.setFieldValue("winning_team_id", null);
      form.setFieldValue("winning_castaways", []);
      return;
    }

    const episodeSnapshot =
      teamAssignments[String(form.values.episode_num)] ?? {};
    const playersOnTeam = getPlayersOnTeam(
      episodeSnapshot,
      teamId as Team["id"],
    );

    form.setFieldValue("winning_team_id", teamId as Team["id"]);
    form.setFieldValue("winning_castaways", playersOnTeam);
  };

  // Only exclude players eliminated before the selected episode
  const eliminatedCastaways = new Set(
    Object.values(eliminations)
      .filter((x) => x.episode_num < form.values.episode_num)
      .map((x) => x.castaway_id),
  );
  const playerOptions = season?.players
    .filter((x) => !eliminatedCastaways.has(x.castaway_id))
    .map((x) => ({ value: x.castaway_id, label: x.full_name }));

  return (
    <CreatePanel
      id="create-challenge"
      title="Add Challenge Result"
      aside={
        <PanelAside title="Recording guidance">
          <Text size="sm" c="dimmed">
            Use the episode number to place this result correctly in the season
            timeline. Team selection is optional and only helps pre-fill winners
            when team assignments exist.
          </Text>
          {!hasEpisodeSnapshot && teamSelectData.length > 0 && (
            <Alert color="orange" variant="light" mt="xs">
              No team assignments exist for this episode yet, so winners need to
              be selected manually.
            </Alert>
          )}
        </PanelAside>
      }
    >
      <form
        onSubmit={form.onSubmit((values) => handleSubmit(values))}
        aria-label="Add challenge result"
      >
        <FormStack>
          <FormRow short>
            <TextInput
              withAsterisk
              readOnly
              label="Season #"
              value={form.values.season_num}
            />

            <FormRow>
              <NumberInput
                withAsterisk
                label="Episode #"
                min={1}
                max={season?.episodes.length}
                {...form.getInputProps("episode_num")}
              />

              <NumberInput
                withAsterisk
                label="Order"
                min={1}
                {...form.getInputProps("order")}
              />
            </FormRow>
          </FormRow>

          {teamSelectData.length > 0 && (
            <Select
              label="Winning Team (optional)"
              placeholder={
                hasEpisodeSnapshot
                  ? "Select a team to auto-fill winners"
                  : "No team assignments for this episode"
              }
              description={
                !hasEpisodeSnapshot
                  ? "Assign players to teams for this episode first"
                  : undefined
              }
              data={teamSelectData}
              clearable
              searchable
              disabled={!hasEpisodeSnapshot}
              value={form.values.winning_team_id ?? null}
              onChange={handleWinningTeamChange}
            />
          )}

          <MultiSelect
            withAsterisk
            label="Winning Players"
            data={playerOptions}
            searchable
            description="Choose the winner or winners for this challenge. Team winners can be auto-filled from the selected team."
            {...form.getInputProps("winning_castaways")}
          />

          <Select
            withAsterisk
            label="Challenge Type"
            data={ChallengeWinActions}
            searchable
            {...form.getInputProps("variant")}
          />

          <FormActions>
            <Button type="submit">Save Challenge</Button>
          </FormActions>
        </FormStack>
      </form>
    </CreatePanel>
  );
};

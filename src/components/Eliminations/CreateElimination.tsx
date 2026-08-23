import {
  Alert,
  Button,
  NumberInput,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { last, orderBy } from "lodash-es";
import { useEffect } from "react";
import { v4 } from "uuid";
import { db } from "../../firebase";
import { useEliminations } from "../../hooks/useEliminations";
import { useSeason } from "../../hooks/useSeason";
import {
  CreatePanel,
  FormActions,
  FormRow,
  FormStack,
  LoadingRow,
  PanelAside,
} from "../../pages/SeasonAdminParts";
import {
  CastawayId,
  Elimination,
  EliminationVariants,
  TeamAssignments,
} from "../../types";
import { EmptySlate } from "../Layout";

const dropdownOptions = EliminationVariants.slice().reverse();

export const CreateElimination = () => {
  const { data: season, isLoading } = useSeason();
  const { data: eliminations } = useEliminations(season?.id);

  const form = useForm<Elimination>({
    initialValues: {
      id: `elimination_${v4()}`,
      season_num: 1,
      season_id: "season_1",
      episode_id: "episode_1",
      episode_num: 1,
      castaway_id: "" as CastawayId,
      variant: dropdownOptions[0],
      order: 0,
    },

    validate: {
      castaway_id: hasLength({ min: 1 }, "Add eliminated player"),
    },

    transformValues: (values) => ({
      ...values,
      episode_id: `episode_${values.episode_num}`,
      season_id: `season_${values.season_num}`,
    }),
  });

  // Set initial values with async request
  useEffect(() => {
    if (season && eliminations) {
      const order =
        (last(orderBy(eliminations, (x) => x.order))?.order || 0) + 1;

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
  }, [season, eliminations]);

  if (isLoading) {
    return <LoadingRow label="Loading season" />;
  }

  if (!season?.episodes?.length) {
    return (
      <EmptySlate title="Create an Episode first before adding eliminations" />
    );
  }

  const handleSubmit = async (values: Elimination) => {
    const _validate = form.validate();

    if (_validate.hasErrors) return;

    try {
      const ref = doc(db, `eliminations/${season?.id}`);
      await setDoc(ref, { [values.id]: values }, { merge: true });

      // Remove eliminated player from team assignments for this episode onward
      await removePlayerFromTeams(
        season!.id,
        values.castaway_id,
        values.episode_num,
      );

      notifications.show({
        title: "Elimination created successfully",
        message: `${season?.castawayLookup?.[values.castaway_id]?.full_name ?? values.castaway_id} eliminated`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      // reset id and important form values
      form.setValues({ id: `elimination_${v4()}` });
    } catch (err) {
      notifications.show({
        title: "Failed to create elimination",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const removePlayerFromTeams = async (
    seasonId: string,
    castawayId: CastawayId,
    fromEpisode: number,
  ) => {
    const assignmentsRef = doc(db, "team_assignments", seasonId);
    const snap = await getDoc(assignmentsRef);
    if (!snap.exists()) return;

    const allAssignments = snap.data() as TeamAssignments;
    let changed = false;

    for (const [epNum, snapshot] of Object.entries(allAssignments)) {
      if (Number(epNum) >= fromEpisode && snapshot[castawayId] !== undefined) {
        snapshot[castawayId] = null;
        changed = true;
      }
    }

    if (changed) {
      await setDoc(assignmentsRef, allAssignments);
    }
  };

  const eliminatedCastaways = new Set(
    Object.values(eliminations).map((x) => x.castaway_id),
  );
  const playerOptions = season?.players
    .filter((x) => !eliminatedCastaways.has(x.castaway_id))
    .map((x) => ({ value: x.castaway_id, label: x.full_name }));

  return (
    <CreatePanel
      id="create-elimination"
      title="Add Elimination"
      aside={
        <PanelAside title="What happens next">
          <Text size="sm" c="dimmed">
            Saving an elimination also removes that player from team assignments
            for this episode onward.
          </Text>
          <Alert color="league" variant="light" mt="xs">
            Enter eliminations in season order. This keeps prop bets, scoring,
            and team state aligned.
          </Alert>
        </PanelAside>
      }
    >
      <form
        onSubmit={form.onSubmit((values) => handleSubmit(values))}
        aria-label="Add elimination"
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

          <Select
            withAsterisk
            label="Elimination Type"
            data={dropdownOptions}
            searchable
            {...form.getInputProps("variant")}
          />

          <Select
            withAsterisk
            label="Eliminated Player"
            data={playerOptions}
            searchable
            {...form.getInputProps("castaway_id")}
          />

          <FormActions>
            <Button type="submit">Save Elimination</Button>
          </FormActions>
        </FormStack>
      </form>
    </CreatePanel>
  );
};

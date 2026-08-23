import { Button, ColorInput, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, setDoc } from "firebase/firestore";
import { v4 } from "uuid";
import { SURVIVOR_SWATCHES } from "../../constants/colors";
import { db } from "../../firebase";
import { useSeason } from "../../hooks/useSeason";
import { Team } from "../../types";
import {
  CreatePanel,
  FormActions,
  FormStack,
  LoadingRow,
  PanelAside,
} from "../SeasonAdmin/SeasonAdminParts";

export const CreateTeam = () => {
  const { data: season, isLoading } = useSeason();

  const form = useForm<Team>({
    initialValues: {
      id: `team_${v4()}`,
      season_id: "season_1",
      season_num: 1,
      name: "",
      color: "#3B82F6",
    },

    validate: {
      name: (value) => (value.trim().length > 0 ? null : "Team name required"),
      color: (value) =>
        /^#[0-9a-fA-F]{6}$/.test(value) ? null : "Valid hex color required",
    },
  });

  if (isLoading) {
    return <LoadingRow label="Loading season" />;
  }

  if (!season) return null;

  const handleSubmit = async (values: Team) => {
    const _validate = form.validate();
    if (_validate.hasErrors) return;

    const payload: Team = {
      ...values,
      season_id: season.id,
      season_num: season.order,
    };

    try {
      const ref = doc(db, `teams/${season.id}`);
      await setDoc(ref, { [payload.id]: payload }, { merge: true });

      notifications.show({
        title: "Team created successfully",
        message: `Team "${values.name}" added`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      form.setValues({ id: `team_${v4()}`, name: "", color: "#3B82F6" });
    } catch (err) {
      notifications.show({
        title: "Failed to create team",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  return (
    <CreatePanel
      id="create-team"
      title="Add Team"
      defaultOpen={false}
      aside={
        <PanelAside title="Team setup">
          <Text size="sm" c="dimmed">
            Create tribe or team records here first, then assign players by
            episode below.
          </Text>
        </PanelAside>
      }
    >
      <form
        onSubmit={form.onSubmit((values) => handleSubmit(values))}
        aria-label="Add team"
      >
        <FormStack>
          <TextInput
            withAsterisk
            readOnly
            label="Season"
            value={`${season.name} (${season.id})`}
          />

          <TextInput
            withAsterisk
            label="Team Name"
            placeholder="e.g. Luvu"
            {...form.getInputProps("name")}
          />

          <ColorInput
            withAsterisk
            label="Team Color"
            format="hex"
            swatches={SURVIVOR_SWATCHES}
            {...form.getInputProps("color")}
          />

          <FormActions>
            <Button type="submit">Save Team</Button>
          </FormActions>
        </FormStack>
      </form>
    </CreatePanel>
  );
};

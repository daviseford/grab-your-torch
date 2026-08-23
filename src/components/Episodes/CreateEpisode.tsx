import {
  Alert,
  Button,
  Checkbox,
  NumberInput,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useSeason } from "../../hooks/useSeason";
import { Episode } from "../../types";
import {
  CreatePanel,
  FormActions,
  FormRow,
  FormStack,
  LoadingRow,
  PanelAside,
} from "../SeasonAdmin/SeasonAdminParts";
import adminParts from "../SeasonAdmin/SeasonAdminParts.module.css";

export const CreateEpisode = () => {
  const { data: season, isLoading } = useSeason();

  const nextOrder = (season?.episodes?.length ?? 0) + 1;

  const form = useForm<Omit<Episode, "id" | "season_id" | "season_num">>({
    initialValues: {
      order: nextOrder,
      name: "",
      finale: false,
      post_merge: false,
      merge_occurs: false,
    },
  });

  if (isLoading) {
    return <LoadingRow label="Loading season" />;
  }

  if (!season) return null;

  const handleSubmit = async (
    values: Omit<Episode, "id" | "season_id" | "season_num">,
  ) => {
    const episode: Episode = {
      id: `episode_${values.order}`,
      season_id: season.id,
      season_num: season.order,
      ...values,
    };

    try {
      const ref = doc(db, "seasons", season.id);
      await updateDoc(ref, { episodes: arrayUnion(episode) });

      notifications.show({
        title: "Episode created successfully",
        message: `Episode ${values.order} added`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      // Reset for next episode
      form.setValues({
        order: values.order + 1,
        name: "",
        finale: false,
        post_merge: values.post_merge || values.merge_occurs,
        merge_occurs: false,
      });
    } catch (err) {
      notifications.show({
        title: "Failed to create episode",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  return (
    <CreatePanel
      id="create-episode"
      title="Add Episode"
      hint={`· next is episode ${nextOrder}`}
      aside={
        <PanelAside title="Before you save">
          <Text size="sm" c="dimmed">
            Start here whenever a new episode airs. The episode record sets the
            context for events, challenges, and eliminations.
          </Text>
          <Alert color="league" variant="light" mt="xs">
            If the merge happens in this episode, turn on{" "}
            <strong>Merge occurs</strong>. If the merge has already happened,
            keep <strong>Post-merge</strong> on for future episodes.
          </Alert>
        </PanelAside>
      }
    >
      <form
        onSubmit={form.onSubmit((values) => handleSubmit(values))}
        aria-label="Add episode"
      >
        <FormStack>
          <TextInput
            withAsterisk
            readOnly
            label="Season"
            value={`${season.name} (${season.id})`}
          />

          <FormRow short>
            <NumberInput
              withAsterisk
              label="Episode #"
              min={1}
              {...form.getInputProps("order")}
            />

            <TextInput
              label="Episode Name"
              placeholder="e.g. The Marooning"
              description="Optional, but useful for keeping the season timeline readable."
              {...form.getInputProps("name")}
            />
          </FormRow>

          <fieldset className={adminParts.fieldset}>
            <legend className={adminParts.legend}>Flags</legend>
            <div className={adminParts.checks}>
              <Checkbox
                label="Merge occurs"
                {...form.getInputProps("merge_occurs", {
                  type: "checkbox",
                })}
              />
              <Checkbox
                label="Post-merge"
                {...form.getInputProps("post_merge", { type: "checkbox" })}
              />
              <Checkbox
                label="Finale"
                {...form.getInputProps("finale", { type: "checkbox" })}
              />
            </div>
          </fieldset>

          <FormActions>
            <Button type="submit">Save Episode</Button>
          </FormActions>
        </FormStack>
      </form>
    </CreatePanel>
  );
};

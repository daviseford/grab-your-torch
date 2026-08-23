import { Badge, Checkbox, Group, Table, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "../../firebase";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import {
  BoardEmpty,
  EditRowActions,
  RowActions,
} from "../../pages/SeasonAdminParts";
import adminParts from "../../pages/SeasonAdminParts.module.css";
import { Episode } from "../../types";
import { Board, EmptySlate } from "../Layout";

export const EpisodeCRUDTable = () => {
  const { data: season } = useSeason();
  const { slimUser } = useUser();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Episode | null>(null);

  const handleDelete = async (episode: Episode) => {
    if (!slimUser?.isAdmin || !season) return;

    modals.openConfirmModal({
      title: `Delete Episode ${episode.order}?`,
      children: (
        <Text size="sm">
          Remove "{episode.name || `Episode ${episode.order}`}" from this
          season. Use this only if the episode was created by mistake.
        </Text>
      ),
      labels: { confirm: "Delete episode", cancel: "Keep it" },
      onConfirm: async () => {
        try {
          const ref = doc(db, "seasons", season.id);
          const updated = season.episodes.filter((e) => e.id !== episode.id);
          await updateDoc(ref, { episodes: updated });
          notifications.show({
            title: "Episode deleted",
            message: `Episode ${episode.order} removed`,
            color: "green",
            icon: <IconCheck size={16} />,
          });
        } catch (err) {
          notifications.show({
            title: "Failed to delete episode",
            message: err instanceof Error ? err.message : "Unknown error",
            color: "red",
            icon: <IconX size={16} />,
          });
        }
      },
    });
  };

  const startEdit = (episode: Episode) => {
    setEditingId(episode.id);
    setEditValues({ ...episode });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues(null);
  };

  const saveEdit = async () => {
    if (!season || !editValues) return;

    try {
      const ref = doc(db, "seasons", season.id);
      const updated = season.episodes.map((e) =>
        e.id === editValues.id ? editValues : e,
      );
      await updateDoc(ref, { episodes: updated });

      notifications.show({
        title: "Episode updated",
        message: `Episode ${editValues.order} saved`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      setEditingId(null);
      setEditValues(null);
    } catch (err) {
      notifications.show({
        title: "Failed to update episode",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const episodes = [...(season?.episodes ?? [])].sort(
    (a, b) => a.order - b.order,
  );

  const rows = episodes.map((e) => {
    const isEditing = editingId === e.id;

    if (isEditing && editValues) {
      return (
        <Table.Tr key={e.id} className={adminParts.editingRow}>
          <Table.Td className={adminParts.num}>{e.order}</Table.Td>
          <Table.Td>
            <TextInput
              size="xs"
              aria-label="Episode name"
              value={editValues.name}
              onChange={(ev) =>
                setEditValues({ ...editValues, name: ev.target.value })
              }
            />
          </Table.Td>
          <Table.Td>
            <Group gap="xs" wrap="nowrap">
              <Checkbox
                size="xs"
                label="Merge"
                checked={editValues.merge_occurs}
                onChange={(ev) =>
                  setEditValues({
                    ...editValues,
                    merge_occurs: ev.target.checked,
                  })
                }
              />
              <Checkbox
                size="xs"
                label="Post-merge"
                checked={editValues.post_merge}
                onChange={(ev) =>
                  setEditValues({
                    ...editValues,
                    post_merge: ev.target.checked,
                  })
                }
              />
              <Checkbox
                size="xs"
                label="Finale"
                checked={editValues.finale}
                onChange={(ev) =>
                  setEditValues({ ...editValues, finale: ev.target.checked })
                }
              />
            </Group>
          </Table.Td>
          {slimUser?.isAdmin && (
            <Table.Td className={adminParts.actionsCell}>
              <EditRowActions
                onSave={saveEdit}
                onCancel={cancelEdit}
                saveLabel="Save episode"
                cancelLabel="Cancel editing episode"
              />
            </Table.Td>
          )}
        </Table.Tr>
      );
    }

    return (
      <Table.Tr key={e.id}>
        <Table.Td className={adminParts.num}>{e.order}</Table.Td>
        <Table.Td className={adminParts.name}>
          {e.name || <span className={adminParts.muted}>—</span>}
        </Table.Td>
        <Table.Td className={adminParts.nowrap}>
          <span className={adminParts.flags}>
            {e.merge_occurs && (
              <Badge size="xs" variant="outline" color="navy">
                Merge
              </Badge>
            )}
            {e.post_merge && (
              <Badge size="xs" variant="outline" color="gray">
                Post-merge
              </Badge>
            )}
            {e.finale && (
              <Badge size="xs" variant="filled" color="ember">
                Finale
              </Badge>
            )}
            {!e.merge_occurs && !e.post_merge && !e.finale && (
              <span className={adminParts.muted}>—</span>
            )}
          </span>
        </Table.Td>
        {slimUser?.isAdmin && (
          <Table.Td className={adminParts.actionsCell}>
            <RowActions
              onEdit={() => startEdit(e)}
              onDelete={() => handleDelete(e)}
              editLabel={`Edit episode ${e.order}`}
              deleteLabel={`Delete episode ${e.order}`}
            />
          </Table.Td>
        )}
      </Table.Tr>
    );
  });

  return (
    <Board
      title="Episodes"
      subtitle={`· ${episodes.length}`}
      titleAs="h2"
      dense
      flush
      scroll
    >
      <Table highlightOnHover className={adminParts.tableMid}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Episode #</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Flags</Table.Th>
            {slimUser?.isAdmin && (
              <Table.Th className={adminParts.actionsHead}>Actions</Table.Th>
            )}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
      {rows.length === 0 && (
        <BoardEmpty>
          <EmptySlate title="No episodes yet.">
            Add the first episode above to start the season timeline.
          </EmptySlate>
        </BoardEmpty>
      )}
    </Board>
  );
};

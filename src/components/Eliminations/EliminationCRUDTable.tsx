import { NumberInput, Select, Stack, Table, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { deleteField, doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { db } from "../../firebase";
import { useEliminations } from "../../hooks/useEliminations";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import {
  CastawayId,
  Elimination,
  EliminationVariant,
  EliminationVariants,
} from "../../types";
import { Board, EmptySlate } from "../Layout";
import {
  BoardEmpty,
  EditRowActions,
  RowActions,
} from "../SeasonAdmin/SeasonAdminParts";
import adminParts from "../SeasonAdmin/SeasonAdminParts.module.css";

type EditValues = {
  order: number;
  variant: EliminationVariant;
  castaway_id: CastawayId;
  episode_num: number;
  votes_received?: number;
};

export const EliminationCRUDTable = () => {
  const { data: season } = useSeason();
  const { data: eliminations } = useEliminations(season?.id);
  const { slimUser } = useUser();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);

  const handleDelete = async (e: Elimination) => {
    if (!slimUser?.isAdmin) return;

    modals.openConfirmModal({
      title: `Delete elimination ${e.order}?`,
      children: (
        <Stack gap="xs">
          <Text size="sm">
            Remove this elimination from the season. Use this only if it was
            created by mistake.
          </Text>
          <Text size="sm" c="dimmed">
            {season?.castawayLookup?.[e.castaway_id]?.full_name ??
              e.castaway_id}{" "}
            &middot; {e.variant} &middot; Episode {e.episode_num}
          </Text>
        </Stack>
      ),
      labels: { confirm: "Delete elimination", cancel: "Keep it" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        const ref = doc(db, `eliminations/${season?.id}`);

        const newEliminations = { ...eliminations };

        delete newEliminations[e.id];

        await setDoc(ref, newEliminations);
      },
    });
  };

  const startEdit = (e: Elimination) => {
    setEditingId(e.id);
    setEditValues({
      order: e.order,
      variant: e.variant,
      castaway_id: e.castaway_id,
      episode_num: e.episode_num,
      votes_received: e.votes_received,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues(null);
  };

  const saveEdit = async (e: Elimination) => {
    if (!editValues || !season) return;

    const orderTaken = Object.values(eliminations ?? {}).some(
      (x) => x.id !== e.id && x.order === editValues.order,
    );
    if (orderTaken) {
      notifications.show({
        title: "Duplicate elimination order",
        message: `Order ${editValues.order} is already used by another elimination`,
        color: "red",
        icon: <IconX size={16} />,
      });
      return;
    }

    try {
      const updated = {
        ...e,
        order: editValues.order,
        variant: editValues.variant,
        castaway_id: editValues.castaway_id,
        episode_num: editValues.episode_num,
        episode_id: `episode_${editValues.episode_num}`,
        votes_received:
          editValues.votes_received !== undefined
            ? editValues.votes_received
            : deleteField(),
      };
      const ref = doc(db, `eliminations/${season.id}`);
      await setDoc(ref, { [e.id]: updated }, { merge: true });

      notifications.show({
        title: "Elimination updated",
        message: `${season?.castawayLookup?.[editValues.castaway_id]?.full_name ?? editValues.castaway_id} (order ${editValues.order}) saved`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      setEditingId(null);
      setEditValues(null);
    } catch (err) {
      notifications.show({
        title: "Failed to update elimination",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const playerOptions =
    season?.players.map((p) => ({
      value: p.castaway_id,
      label: p.full_name,
    })) ?? [];
  const variantOptions = EliminationVariants.slice().reverse();

  const rows = Object.values(eliminations || {})
    .sort((a, b) => b.order - a.order)
    .map((e) => {
      const isEditing = editingId === e.id;

      if (isEditing && editValues) {
        return (
          <Table.Tr key={e.id} className={adminParts.editingRow}>
            <Table.Td>
              <NumberInput
                size="xs"
                aria-label="Order"
                min={1}
                value={editValues.order}
                onChange={(val) =>
                  setEditValues({ ...editValues, order: Number(val) || 1 })
                }
                w={70}
              />
            </Table.Td>
            <Table.Td>
              <Select
                size="xs"
                aria-label="Variant"
                data={variantOptions as unknown as string[]}
                value={editValues.variant}
                onChange={(val) =>
                  setEditValues({
                    ...editValues,
                    variant: (val as EliminationVariant) ?? editValues.variant,
                  })
                }
                w={180}
              />
            </Table.Td>
            <Table.Td>
              <Select
                size="xs"
                aria-label="Player"
                data={playerOptions}
                value={editValues.castaway_id}
                searchable
                onChange={(val) =>
                  setEditValues({
                    ...editValues,
                    castaway_id: (val as CastawayId) ?? editValues.castaway_id,
                  })
                }
                w={180}
              />
            </Table.Td>
            <Table.Td>
              <NumberInput
                size="xs"
                aria-label="Episode number"
                min={1}
                max={season?.episodes.length}
                value={editValues.episode_num}
                onChange={(val) =>
                  setEditValues({
                    ...editValues,
                    episode_num: Number(val) || 1,
                  })
                }
                w={70}
              />
            </Table.Td>
            <Table.Td>
              <NumberInput
                size="xs"
                aria-label="Votes received"
                min={0}
                value={editValues.votes_received ?? ""}
                placeholder="—"
                onChange={(val) =>
                  setEditValues({
                    ...editValues,
                    votes_received: val === "" ? undefined : Number(val),
                  })
                }
                w={70}
              />
            </Table.Td>
            {slimUser?.isAdmin && (
              <Table.Td className={adminParts.actionsCell}>
                <EditRowActions
                  onSave={() => saveEdit(e)}
                  onCancel={cancelEdit}
                  saveLabel="Save elimination"
                  cancelLabel="Cancel editing elimination"
                />
              </Table.Td>
            )}
          </Table.Tr>
        );
      }

      return (
        <Table.Tr key={e.id}>
          <Table.Td className={adminParts.num}>{e.order}</Table.Td>
          <Table.Td className={adminParts.name}>{e.variant}</Table.Td>
          <Table.Td className={adminParts.nowrap}>
            {season?.castawayLookup?.[e.castaway_id]?.full_name ??
              e.castaway_id}
          </Table.Td>
          <Table.Td className={adminParts.id}>episode_{e.episode_num}</Table.Td>
          <Table.Td className={adminParts.num}>
            {e.votes_received ?? <span className={adminParts.muted}>—</span>}
          </Table.Td>
          {slimUser?.isAdmin && (
            <Table.Td className={adminParts.actionsCell}>
              <RowActions
                onEdit={() => startEdit(e)}
                onDelete={() => handleDelete(e)}
                editLabel={`Edit elimination ${e.order}`}
                deleteLabel={`Delete elimination ${e.order}`}
              />
            </Table.Td>
          )}
        </Table.Tr>
      );
    });

  return (
    <Board
      title="Eliminations"
      subtitle={`· ${rows.length}`}
      titleAs="h2"
      dense
      flush
      scroll
    >
      <Table highlightOnHover className={adminParts.tableWide}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Order</Table.Th>
            <Table.Th>Variant</Table.Th>
            <Table.Th>Player</Table.Th>
            <Table.Th>Episode</Table.Th>
            <Table.Th>Votes</Table.Th>
            {slimUser?.isAdmin && (
              <Table.Th className={adminParts.actionsHead}>Actions</Table.Th>
            )}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
      {rows.length === 0 && (
        <BoardEmpty>
          <EmptySlate title="No eliminations recorded yet." />
        </BoardEmpty>
      )}
    </Board>
  );
};

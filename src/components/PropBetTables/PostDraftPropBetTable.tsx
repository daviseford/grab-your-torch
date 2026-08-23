import { Table } from "@mantine/core";
import { getActivePropBetKeys, PropBetsQuestions } from "../../data/propbets";
import { useCompetition } from "../../hooks/useCompetition";
import { useDraft } from "../../hooks/useDraft";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import type { CastawayId, CastawayLookup } from "../../types";

/** Resolve a prop bet answer to a display name if it's a castaway ID. */
const resolveAnswer = (answer: string, lookup?: CastawayLookup): string => {
  if (!answer || !lookup) return answer;
  return lookup[answer as CastawayId]?.full_name ?? answer;
};

/** Cyan bar on the viewer's own row (a mark, like the standings board). */
const ME_ROW_MARK = {
  boxShadow: "inset 3px 0 0 var(--mantine-color-signal-5)",
};

/**
 * Every participant's prop bets, one row each. Renders the table only;
 * the caller frames it in a board that scrolls locally.
 */
export const PostDraftPropBetTable = () => {
  const { draft } = useDraft();
  const { slimUser } = useUser();
  const { data: season } = useSeason(draft?.season_id);
  const { data: competition } = useCompetition(draft?.competiton_id);

  if (!draft?.prop_bets) return null;

  const lookup = season?.castawayLookup;
  const activeKeys = getActivePropBetKeys(draft.prop_bets);

  if (activeKeys.length === 0) return null;

  const rows = draft.prop_bets.map((p) => {
    const isMe = p.user_uid === slimUser?.uid;
    return (
      <Table.Tr key={p.id}>
        <Table.Td fw={600} style={isMe ? ME_ROW_MARK : undefined}>
          {competition?.team_names?.[p.user_uid] || p.user_name}
          {isMe && (
            <>
              {" "}
              <span
                style={{
                  fontWeight: 500,
                  color: "var(--mantine-color-dimmed)",
                }}
              >
                (you)
              </span>
            </>
          )}
        </Table.Td>
        {activeKeys.map((key) => (
          <Table.Td key={key} style={{ whiteSpace: "nowrap" }}>
            {resolveAnswer(p.values[key] || "", lookup)}
          </Table.Td>
        ))}
      </Table.Tr>
    );
  });

  return (
    <Table highlightOnHover verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Participant</Table.Th>
          {activeKeys.map((key) => (
            <Table.Th key={key}>{PropBetsQuestions[key].description}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  );
};

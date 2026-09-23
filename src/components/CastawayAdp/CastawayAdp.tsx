import {
  ActionIcon,
  Popover,
  SegmentedControl,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import {
  type CastawayAdpStat,
  type CastawayAdpState,
  formatAdp,
} from "../../utils/castawayAdp";
import classes from "./CastawayAdp.module.css";

export type CastSort = "name" | "adp";

const draftsNoun = (count: number) =>
  count === 1 ? "1 draft" : `${count} drafts`;

const describeStat = (
  name: string,
  stat: CastawayAdpStat | undefined,
  draftCount: number,
) =>
  stat
    ? `${name}: average draft position ${formatAdp(stat.adp)}. Picked in ${stat.picks} of ${draftsNoun(draftCount)}, earliest at pick ${stat.best}, latest at pick ${stat.worst}.`
    : `${name}: no average draft position. Not picked in any of the ${draftsNoun(draftCount)}.`;

type CastawayAdpTagProps = {
  name: string;
  stat: CastawayAdpStat | undefined;
  draftCount: number;
};

/**
 * One slate's ADP line. The short form is for sighted readers; the tooltip
 * and the hidden sentence carry the sample size and range.
 */
export const CastawayAdpTag = ({
  name,
  stat,
  draftCount,
}: CastawayAdpTagProps) => {
  const sentence = describeStat(name, stat, draftCount);
  return (
    <Tooltip
      label={sentence}
      multiline
      w={240}
      withArrow
      events={{ hover: true, focus: true, touch: true }}
    >
      <span className={classes.tag} tabIndex={0}>
        <span aria-hidden="true" className={classes.label}>
          ADP
        </span>
        <span aria-hidden="true" className={classes.value}>
          {stat ? formatAdp(stat.adp) : "—"}
        </span>
        <span aria-hidden="true" className={classes.sample}>
          {stat ? `in ${stat.picks} of ${draftCount}` : "not picked"}
        </span>
        <VisuallyHidden>{sentence}</VisuallyHidden>
      </span>
    </Tooltip>
  );
};

const formatUpdated = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const Explanation = ({ updated }: { updated: string | null }) => (
  <div className={classes.explain}>
    <p>
      Average draft position is the average overall pick number a castaway went
      at: 1 is the first pick of a draft, and the count keeps going across every
      round.
    </p>
    <p>
      It covers every Grab Your Torch draft for this season that finished before
      the premiere aired, not only your groups, so it never reflects what
      happened on the show. Your draft is not included.
    </p>
    <p>
      A castaway only counts in drafts that picked them; each slate shows how
      many did. Trades don't change it.
      {updated ? ` Updated ${updated}.` : ""}
    </p>
  </div>
);

type CastawayAdpNoteProps = {
  state: CastawayAdpState;
  sort: CastSort;
  onSortChange: (sort: CastSort) => void;
};

/**
 * The line above the cast grid: what ADP means and how much data backs it,
 * or plainly that there is none, plus the sort control once numbers exist.
 */
export const CastawayAdpNote = ({
  state,
  sort,
  onSortChange,
}: CastawayAdpNoteProps) => {
  if (state.kind === "loading") return null;

  if (state.kind !== "ready") {
    return (
      <p className={classes.noteText} role="note">
        {state.kind === "unavailable"
          ? "Average draft position isn't available for this season yet."
          : state.closed
            ? `No average draft position for this season: it needs ${state.minDrafts} drafts finished before the premiere, and ${state.draftCount} did.`
            : `Average draft position appears once ${state.minDrafts} drafts for this season finish before the premiere. So far: ${state.draftCount}.`}
      </p>
    );
  }

  const { summary } = state;
  const updated = formatUpdated(summary.computed_at);
  return (
    <div className={classes.note}>
      <p className={classes.noteText}>
        <span>
          ADP: average overall pick across {draftsNoun(summary.draft_count)}{" "}
          finished before the premiere. Lower means earlier.
        </span>
        <Popover width={300} position="bottom-start" withArrow shadow="md">
          <Popover.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label="How average draft position works"
            >
              <IconInfoCircle size={16} />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Explanation updated={updated} />
          </Popover.Dropdown>
        </Popover>
      </p>
      <SegmentedControl
        className={classes.sort}
        size="xs"
        aria-label="Sort the cast"
        value={sort}
        onChange={(value) => onSortChange(value as CastSort)}
        data={[
          { label: "A–Z", value: "name" },
          { label: "By ADP", value: "adp" },
        ]}
      />
    </div>
  );
};

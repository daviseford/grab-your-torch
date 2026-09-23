import {
  ActionIcon,
  Button,
  Popover,
  SegmentedControl,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { useId, useRef, useState } from "react";
import type { CastawayId } from "../../types";
import {
  type AdpCohort,
  type CastawayAdpStat,
  type CastawayAdpState,
  type CastawayAdpSummary,
  formatAdp,
} from "../../utils/castawayAdp";
import classes from "./CastawayAdp.module.css";

export type CastSort = "name" | "adp";

const draftsNoun = (count: number) =>
  count === 1 ? "1 draft" : `${count} drafts`;

const cohortPhrase = (cohort: AdpCohort) =>
  cohort === "pre_premiere"
    ? "drafts saved before the premiere"
    : "all drafts, including ones made after episodes aired";

const thresholdPhrase = (summary: CastawayAdpSummary) =>
  `picks in at least ${draftsNoun(summary.min_drafts)} made by ${summary.min_creators} different people`;

const describeStat = (
  name: string,
  stat: CastawayAdpStat | undefined,
  summary: CastawayAdpSummary,
) =>
  stat
    ? `${name}: average draft position ${formatAdp(stat.adp)} across ${cohortPhrase(summary.cohort)}. Picked in ${stat.picks} of ${draftsNoun(summary.draft_count)}.`
    : `${name}: no average draft position shown. It needs ${thresholdPhrase(summary)}.`;

type CastawayAdpTagProps = {
  name: string;
  castawayId: CastawayId;
  summary: CastawayAdpSummary;
};

/**
 * One slate's ADP line. Not focusable: keyboard and screen-reader users get
 * the same sentence from the hidden text, read in place, instead of an extra
 * tab stop on every slate. The tooltip repeats it for pointer and touch.
 */
export const CastawayAdpTag = ({
  name,
  castawayId,
  summary,
}: CastawayAdpTagProps) => {
  const stat = summary.castaways[castawayId];
  const sentence = describeStat(name, stat, summary);
  return (
    <Tooltip
      label={sentence}
      multiline
      w={240}
      withArrow
      events={{ hover: true, focus: false, touch: true }}
    >
      <span className={classes.tag} data-cohort={summary.cohort}>
        <span aria-hidden="true" className={classes.label}>
          {summary.cohort === "all_drafts" ? "All ADP" : "ADP"}
        </span>
        <span aria-hidden="true" className={classes.value}>
          {stat ? formatAdp(stat.adp) : "—"}
        </span>
        <span aria-hidden="true" className={classes.sample}>
          {stat
            ? `in ${stat.picks} of ${summary.draft_count}`
            : "too few picks"}
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

const Explanation = ({ summary }: { summary: CastawayAdpSummary }) => {
  const updated = formatUpdated(summary.computed_at);
  const unsealed =
    summary.sealed_count === null
      ? 0
      : summary.draft_count - summary.sealed_count;
  return (
    <div className={classes.explain}>
      <p>
        Average draft position is the average overall pick number a castaway
        went at: 1 is the first pick of a draft, and the count keeps going
        across every round. Lower means earlier.
      </p>
      {summary.cohort === "pre_premiere" ? (
        <p>
          It counts Grab Your Torch drafts for this season, from every group,
          that were saved as a competition before the premiere aired. Drafts
          still in progress, this one included, aren't counted.
          {unsealed > 0 &&
            ` ${unsealed} of those ${unsealed === 1 ? "record was" : "records were"} edited after the premiere, for example to reveal an episode, so the picks were matched against the original draft record instead. That check makes a later change to the picks unlikely but can't rule it out.`}
        </p>
      ) : (
        <p>
          It counts every qualifying Grab Your Torch draft for this season, from
          every group, including drafts made after episodes aired. Those picks
          can reflect how the season played out.
          {updated ? ` Updated ${updated}.` : ""}
        </p>
      )}
      <p>
        Every draft needs at least two people, and the same group drafting again
        counts once. A castaway's average appears only once it has{" "}
        {thresholdPhrase(summary)}, so one group's board can't be read back out.
        Trades don't change it.
      </p>
    </div>
  );
};

/** The sentence shown when a cohort has no castaway averages to show. */
const emptyMessage = (
  state: Exclude<CastawayAdpState, { kind: "loading" } | { kind: "ready" }>,
  cohort: AdpCohort,
) => {
  if (state.kind === "unavailable") {
    return cohort === "pre_premiere"
      ? "Average draft position isn't available for this season."
      : "All-drafts average draft position isn't available for this season.";
  }
  const { summary, closed } = state;
  const need = thresholdPhrase(summary);
  if (cohort === "all_drafts") {
    return `No all-drafts averages yet: a castaway needs ${need}. Qualifying drafts so far: ${summary.draft_count}.`;
  }
  return closed
    ? `No average draft position for this season: ${draftsNoun(summary.draft_count)} were saved before the premiere, and no castaway had ${need}.`
    : `Average draft position appears once a castaway has ${need}, saved before the premiere. Drafts so far: ${summary.draft_count}.`;
};

type AllDraftsControlProps = {
  active: boolean;
  onChange: (active: boolean) => void;
};

/**
 * The opt-in to all-drafts numbers. Nothing from that cohort is fetched or
 * shown until the viewer reads the spoiler warning and confirms.
 */
const AllDraftsControl = ({ active, onChange }: AllDraftsControlProps) => {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const warningId = useId();

  if (active) {
    return (
      <div className={classes.cohortBar} data-cohort="all_drafts">
        <IconAlertTriangle size={14} aria-hidden="true" />
        <span>
          Showing all drafts, including ones made after episodes aired.
        </span>
        <Button
          variant="subtle"
          color="gray"
          size="compact-xs"
          onClick={() => onChange(false)}
        >
          Back to pre-premiere only
        </Button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button
        className={classes.optIn}
        variant="subtle"
        color="gray"
        size="compact-xs"
        onClick={() => {
          setConfirming(true);
          requestAnimationFrame(() => confirmRef.current?.focus());
        }}
      >
        Include drafts made after the premiere…
      </Button>
    );
  }

  const handleConfirm = () => {
    setConfirming(false);
    onChange(true);
  };

  return (
    <div className={classes.warning} role="group" aria-labelledby={warningId}>
      <p id={warningId} className={classes.warningText}>
        <IconAlertTriangle size={14} aria-hidden="true" />
        <span>
          Spoiler warning: drafts made after episodes aired can hint at how the
          season played out. Skip this if you're watching along.
        </span>
      </p>
      <div className={classes.warningActions}>
        <Button
          ref={confirmRef}
          size="compact-xs"
          color="orange"
          variant="light"
          onClick={handleConfirm}
        >
          Show all-drafts ADP
        </Button>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};

type CastawayAdpNoteProps = {
  state: CastawayAdpState;
  cohort: AdpCohort;
  sort: CastSort;
  onSortChange: (sort: CastSort) => void;
  /** Offer the all-drafts opt-in; omitted before the premiere, when it adds nothing. */
  allDrafts?: AllDraftsControlProps;
};

/**
 * The line above the cast grid: which cohort is shown, what ADP means and
 * how much data backs it, or plainly that there is none, plus the sort
 * control once numbers exist and the all-drafts opt-in.
 */
export const CastawayAdpNote = ({
  state,
  cohort,
  sort,
  onSortChange,
  allDrafts,
}: CastawayAdpNoteProps) => {
  if (state.kind === "loading" && cohort === "pre_premiere") return null;

  const body = (() => {
    if (state.kind === "loading") return null;
    if (state.kind !== "ready") {
      return (
        <p className={classes.noteText} role="note">
          {emptyMessage(state, cohort)}
        </p>
      );
    }
    const { summary } = state;
    return (
      <div className={classes.note}>
        <p className={classes.noteText}>
          <span>
            {cohort === "pre_premiere" ? "ADP" : "All-drafts ADP"}: average
            overall pick across {draftsNoun(summary.draft_count)}{" "}
            {cohort === "pre_premiere"
              ? "saved before the premiere"
              : "of every kind, including after episodes aired"}
            .
          </span>
          <Popover width={320} position="bottom-start" withArrow shadow="md">
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
              <Explanation summary={summary} />
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
  })();

  return (
    <div className={classes.stack}>
      {allDrafts && <AllDraftsControl {...allDrafts} />}
      {body}
    </div>
  );
};

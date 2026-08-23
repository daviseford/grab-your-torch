import { Badge, type BadgeProps } from "@mantine/core";
import classes from "./StatusBadge.module.css";

export type StatusKind =
  | "live"
  | "watch-along"
  | "in-progress"
  | "complete"
  | "pending"
  | "season"
  | "admin";

type StatusBadgeProps = Omit<
  BadgeProps,
  "variant" | "color" | "children" | "leftSection"
> & {
  kind: StatusKind;
  /** Override the default label for the kind. */
  children?: React.ReactNode;
};

const LABELS: Record<StatusKind, string> = {
  live: "Live",
  "watch-along": "Watch-along",
  "in-progress": "In progress",
  complete: "Complete",
  pending: "Pending",
  season: "Season",
  admin: "Admin",
};

/**
 * Status slates in the package's vocabulary. Live is the cyan signal (with
 * a dot), watch-along is the gold tape band, complete and pending are
 * outlined, season is a navy plate, admin is the flame.
 */
export const StatusBadge = ({
  kind,
  children,
  className,
  ...rest
}: StatusBadgeProps) => (
  // No `variant`/`color`: Mantine would then write its own --badge-* vars
  // inline and beat the kind classes below.
  <Badge
    radius="xs"
    className={[classes.root, classes[kind], className]
      .filter(Boolean)
      .join(" ")}
    leftSection={
      kind === "live" ? (
        <span className={classes.dot} aria-hidden="true" />
      ) : undefined
    }
    {...rest}
  >
    {children ?? LABELS[kind]}
  </Badge>
);

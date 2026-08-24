import { Button } from "@mantine/core";
import { Link } from "react-router-dom";
import {
  useRecentDrafts,
  type RecentDraftStatus,
} from "../../hooks/useRecentDrafts";
import { StatusBadge, type StatusKind } from "../Layout";
import classes from "./Home.module.css";

const MAX_SHOWN = 3;

const STATUS_KINDS: Record<RecentDraftStatus, StatusKind> = {
  lobby: "pending",
  "your-turn": "live",
  "in-progress": "in-progress",
};

const STATUS_LABELS: Record<RecentDraftStatus, string> = {
  lobby: "Waiting in lobby",
  "your-turn": "Your turn",
  "in-progress": "Draft in progress",
};

/**
 * Way back into drafts the user participates in (see utils/recentDrafts).
 * Renders nothing when there are no open drafts, so signed-out users and
 * users without one see the page unchanged.
 */
export const HomeResumeDrafts = () => {
  const recentDrafts = useRecentDrafts();
  if (recentDrafts.length === 0) return null;

  return (
    <section aria-labelledby="home-resume" className={classes.section}>
      <div className={classes.inner}>
        <div className={classes.head}>
          <h2 id="home-resume" className={classes.h2}>
            Jump back in
          </h2>
          <p className={classes.lead}>
            {recentDrafts.length === 1
              ? "You're in a draft that's still going."
              : "You're in drafts that are still going."}{" "}
            Pick up right where you left off.
          </p>
        </div>
        <ul className={classes.resumeList}>
          {recentDrafts.slice(0, MAX_SHOWN).map(({ draft, url, status }) => (
            <li key={draft.id}>
              <StatusBadge kind={STATUS_KINDS[status]}>
                {STATUS_LABELS[status]}
              </StatusBadge>
              <span className={classes.resumeTitle}>
                Season {draft.season_num} draft
              </span>
              <Button
                component={Link}
                to={url}
                variant="outline"
                className={classes.resumeAction}
              >
                Resume draft
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

import { IconClockPause } from "@tabler/icons-react";
import classes from "./ScoringDelayBanner.module.css";

/**
 * TEMPORARY site-wide notice: official Season 51 scoring data is delayed.
 *
 * Removal criterion: delete this component, its CSS module, and its single
 * use in `src/AppRoutes.tsx` once official Season 51 scores are available
 * AND have been published and verified in the app. An upstream message alone
 * is not enough, and there is deliberately no date-based expiry.
 */
export const ScoringDelayBanner = () => (
  <aside className={classes.root} aria-labelledby="scoring-delay-banner-title">
    <div className={classes.inner}>
      <IconClockPause className={classes.icon} size={22} aria-hidden />
      <div className={classes.copy}>
        <p className={classes.label} id="scoring-delay-banner-title">
          Season 51 scoring update
        </p>
        <p className={classes.body}>
          Official scoring data is temporarily delayed while the scoring
          provider relocates internationally. We expect an update in the next
          few days and will publish scores as soon as they are available. Thank
          you for your patience.
        </p>
      </div>
    </div>
  </aside>
);

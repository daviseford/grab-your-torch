import { Notice } from "./Notice";
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
  <div className={classes.root}>
    <Notice label="Season 51 scoring update" tone="warning" role="status">
      Official scoring data is temporarily delayed while the scoring provider
      relocates internationally. We expect an update in the next few days and
      will publish scores as soon as they are available. Thank you for your
      patience.
    </Notice>
  </div>
);

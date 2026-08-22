import { BrandEmblem } from "../Brand";
import classes from "./RouteLoading.module.css";

/**
 * Suspense fallback for lazy routes. Reserves stable space, announces
 * progress, and shows the brand mark instead of an unbranded spinner.
 */
export const RouteLoading = () => (
  <div className={classes.root} role="status" aria-live="polite">
    <BrandEmblem height={48} className={classes.emblem} />
    <span className={classes.label}>Loading</span>
  </div>
);

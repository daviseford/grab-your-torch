import classes from "./BrandLockup.module.css";
import { LOCKUP_MIN_WIDTH, STACKED_MIN_WIDTH } from "./brandSizes";

/** The primary lockup's viewBox is 760 x 220. */
const LOCKUP_ASPECT = 220 / 760;

export type BrandScheme = "light" | "dark";

interface BrandLockupProps {
  /** Rendered width in px; never below the 160 px brand minimum. */
  width?: number;
  /**
   * Force the variant for the background it sits on. Omit to follow the
   * active color scheme (dark lockup on dark surfaces, light on light).
   */
  on?: BrandScheme;
  className?: string;
  /** Decorative when the surrounding link already names the brand. */
  decorative?: boolean;
}

/**
 * The horizontal "Grab Your Torch" lockup, served as an outlined SVG so the
 * wordmark never depends on the visitor's fonts.
 */
export const BrandLockup = ({
  width = 180,
  on,
  className,
  decorative = false,
}: BrandLockupProps) => {
  const w = Math.max(LOCKUP_MIN_WIDTH, width);
  const alt = decorative ? "" : "Grab Your Torch";
  const shared = {
    width: w,
    height: Math.round(w * LOCKUP_ASPECT),
    decoding: "async" as const,
    draggable: false,
  };
  if (on) {
    return (
      <img
        src={`/brand/grab-your-torch-primary-${on}.svg`}
        alt={alt}
        className={className}
        {...shared}
      />
    );
  }
  // Both variants render and CSS shows the one for the active scheme, so
  // the lockup is right from the first paint and needs no re-render.
  return (
    <>
      <img
        src="/brand/grab-your-torch-primary-light.svg"
        alt={alt}
        className={[classes.light, className].filter(Boolean).join(" ")}
        {...shared}
      />
      <img
        src="/brand/grab-your-torch-primary-dark.svg"
        alt=""
        aria-hidden="true"
        className={[classes.dark, className].filter(Boolean).join(" ")}
        {...shared}
      />
    </>
  );
};

interface BrandStackedProps {
  /** Rendered size in px (square); never below the 96 px brand minimum. */
  size?: number;
  className?: string;
  decorative?: boolean;
}

/**
 * The stacked lockup for square or narrow compositions (auth, reset,
 * not-found). Its wordmark is Night Navy on transparent, so it belongs on
 * light surfaces; use the emblem on navy plates.
 */
export const BrandStacked = ({
  size = 160,
  className,
  decorative = false,
}: BrandStackedProps) => {
  const s = Math.max(STACKED_MIN_WIDTH, size);
  return (
    <img
      src="/brand/grab-your-torch-stacked.svg"
      alt={decorative ? "" : "Grab Your Torch"}
      width={s}
      height={s}
      className={className}
      decoding="async"
      draggable={false}
    />
  );
};

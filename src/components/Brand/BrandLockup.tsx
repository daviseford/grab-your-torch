import { useComputedColorScheme } from "@mantine/core";
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
  const scheme = useComputedColorScheme("light");
  const variant = on ?? scheme;
  const w = Math.max(LOCKUP_MIN_WIDTH, width);
  return (
    <img
      src={`/brand/grab-your-torch-primary-${variant}.svg`}
      alt={decorative ? "" : "Grab Your Torch"}
      width={w}
      height={Math.round(w * LOCKUP_ASPECT)}
      className={className}
      decoding="async"
      draggable={false}
    />
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

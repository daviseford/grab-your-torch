import {
  createTheme,
  rem,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from "@mantine/core";

/**
 * Victory Flame brand system (docs/brand/brand-guidelines.md) expressed as
 * Mantine tokens. Brand scales are named so they never collide with the
 * semantic Mantine colors the app still uses for scoring categories
 * (blue, teal, yellow, grape, gray) and for success, warning, and danger.
 *
 * Index 6 is the brand hex on light backgrounds (Mantine's default primary
 * shade); dark mode uses index 4 for buttons so text keeps its contrast.
 */
const league: MantineColorsTuple = [
  "#eff4fa",
  "#d1e0f4",
  "#b0ccf1",
  "#8cb7f0",
  "#66a2f3",
  "#3d8df7",
  "#1177ff",
  "#0058cd",
  "#003b8a",
  "#001f47",
];

const signal: MantineColorsTuple = [
  "#ecf7f9",
  "#c9ebf0",
  "#a2e2eb",
  "#77dbea",
  "#49d7ec",
  "#18d5f2",
  "#0bb2cb",
  "#09879b",
  "#065d6a",
  "#03333a",
];

const ember: MantineColorsTuple = [
  "#faf1ef",
  "#f6dcd6",
  "#f3c5ba",
  "#f3ac9d",
  "#f4927d",
  "#f9775b",
  "#ff5a36",
  "#e62900",
  "#971b00",
  "#470d00",
];

const gold: MantineColorsTuple = [
  "#fcf9f3",
  "#f5eacd",
  "#f3dca2",
  "#f7d172",
  "#ffc83d",
  "#ffbb10",
  "#e2a200",
  "#b58200",
  "#896200",
  "#5c4200",
];

const navy: MantineColorsTuple = [
  "#f0f4f9",
  "#cddbed",
  "#a8c2e3",
  "#82a8db",
  "#598ed4",
  "#2f74ce",
  "#225eac",
  "#174888",
  "#0e3262",
  "#071d3a",
];

/**
 * Dark mode is Night Navy broadcast glass rather than Mantine's neutral
 * charcoal. Mantine reads this scale for dark-mode surfaces: 0 is text,
 * 2 is dimmed text, 4 is borders, 6 is component backgrounds, 7 is the body.
 */
const dark: MantineColorsTuple = [
  "#eaf8ff",
  "#b8d9ee",
  "#8fa9c4",
  "#5e7a9a",
  "#1e3d66",
  "#0e2b52",
  "#0b2344",
  "#051428",
  "#040f1f",
  "#02080f",
];

export const BRAND_FONT_FAMILY =
  '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const BRAND_DISPLAY_FAMILY =
  '"Space Grotesk Variable", "Space Grotesk", "Inter Variable", Inter, system-ui, sans-serif';

export const theme = createTheme({
  primaryColor: "league",
  primaryShade: { light: 6, dark: 6 },
  colors: { league, signal, ember, gold, navy, dark },
  white: "#ffffff",
  black: "#071d3a",
  defaultRadius: "sm",
  autoContrast: true,
  luminanceThreshold: 0.45,
  fontFamily: BRAND_FONT_FAMILY,
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  defaultGradient: {
    from: "league",
    to: "signal",
    deg: 135,
  },
  headings: {
    fontFamily: BRAND_DISPLAY_FAMILY,
    fontWeight: "700",
    sizes: {
      h1: { fontSize: rem(40), fontWeight: "700", lineHeight: "1.08" },
      h2: { fontSize: rem(28), fontWeight: "700", lineHeight: "1.2" },
      h3: { fontSize: rem(20), fontWeight: "700", lineHeight: "1.3" },
      h4: { fontSize: rem(17), fontWeight: "600", lineHeight: "1.4" },
      h5: { fontSize: rem(15), fontWeight: "600", lineHeight: "1.4" },
      h6: { fontSize: rem(13), fontWeight: "600", lineHeight: "1.4" },
    },
  },
  other: {
    // Broadcast package tokens that have no Mantine equivalent.
    labelTracking: "0.14em",
  },
  components: {
    AppShell: {
      styles: {
        header: {
          backgroundColor: "var(--gyt-plate)",
          borderColor: "var(--gyt-plate-rule)",
        },
        navbar: {
          backgroundColor: "var(--gyt-plate)",
          borderColor: "var(--gyt-plate-rule)",
        },
        main: {
          backgroundColor: "var(--mantine-color-body)",
        },
      },
    },
    Badge: {
      defaultProps: {
        radius: "xs",
      },
      styles: {
        root: {
          fontFamily: BRAND_DISPLAY_FAMILY,
          letterSpacing: "0.1em",
        },
        label: {
          textBoxTrim: "none",
        },
      },
    },
    Button: {
      defaultProps: {
        radius: "sm",
      },
    },
    NavLink: {
      defaultProps: {
        variant: "filled",
      },
      styles: {
        root: {
          borderRadius: "var(--mantine-radius-sm)",
        },
      },
    },
    Paper: {
      defaultProps: {
        radius: "md",
      },
    },
    Modal: {
      defaultProps: {
        radius: "md",
        overlayProps: { backgroundOpacity: 0.6 },
      },
      styles: {
        content: {
          border: "1px solid var(--gyt-rule)",
        },
        header: {
          borderBottom: "1px solid var(--gyt-rule)",
        },
        title: {
          fontFamily: BRAND_DISPLAY_FAMILY,
          fontWeight: 700,
        },
      },
    },
    Tabs: {
      styles: {
        tab: {
          fontFamily: BRAND_DISPLAY_FAMILY,
          fontWeight: 600,
          fontSize: "0.75rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        },
      },
    },
    Loader: {
      defaultProps: {
        color: "league",
      },
    },
    Card: {
      defaultProps: {
        radius: "md",
      },
    },
  },
});

/**
 * Scheme-aware surface tokens used by the shell and shared primitives.
 * Light is the studio (Ice White ground, navy plates); dark is the broadcast
 * glass (Night Navy ground, deeper navy plates).
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--gyt-signal": "var(--mantine-color-signal-5)",
  },
  light: {
    "--mantine-color-body": "#f3f8fc",
    "--gyt-plate": "#071d3a",
    "--gyt-plate-rule": "rgba(184, 217, 238, 0.14)",
    "--gyt-panel": "#ffffff",
    "--gyt-panel-2": "#e9f2f9",
    "--gyt-rule": "#cfdde9",
    "--gyt-rule-strong": "#9fb8cc",
    "--gyt-signal-text": "#0a9fbf",
  },
  dark: {
    "--gyt-plate": "#0b2344",
    "--gyt-plate-rule": "rgba(184, 217, 238, 0.14)",
    "--gyt-panel": "#0b2344",
    "--gyt-panel-2": "#0e2b52",
    "--gyt-rule": "#1e3d66",
    "--gyt-rule-strong": "#35588a",
    "--gyt-signal-text": "#18d5f2",
  },
});

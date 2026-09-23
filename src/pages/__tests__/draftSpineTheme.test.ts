/**
 * The Draft Results spine in light mode.
 *
 * The draft spine is a navy plate in both schemes, except on the finished
 * Draft Results summary, where light mode moves it onto the studio panel so
 * it reads as one surface with the summary below (`.spineStudio`). Nothing
 * type-checks CSS, so this test resolves the studio tokens against the real
 * theme and asserts a light surface with readable text, and that the spine
 * and board rules read those tokens instead of hard-coding plate colors
 * (which would silently put Ice White text on the white panel).
 */

import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { cssVariablesResolver, theme } from "../../theme";

// Vitest stubs .css imports (even ?raw) and this tsconfig carries no Node
// types, so read the stylesheet through Node's builtin fs directly.
type NodeFs = { readFileSync: (path: URL, encoding: "utf8") => string };
const { readFileSync } = (
  globalThis as unknown as {
    process: { getBuiltinModule: (id: "node:fs") => NodeFs };
  }
).process.getBuiltinModule("node:fs");
const draftCss = readFileSync(
  new URL("../Draft.module.css", import.meta.url),
  "utf8",
);
const css = postcss.parse(draftCss);

const STUDIO_SELECTOR = '[data-mantine-color-scheme="light"] .spineStudio';

const lightVars: Record<string, string> = cssVariablesResolver(
  theme as Parameters<typeof cssVariablesResolver>[0],
).light;

/** Resolves a declared value to a hex color using the light-scheme theme. */
const resolveColor = (value: string): string => {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const mantine = trimmed.match(/^var\(--mantine-color-([a-z]+)-(\d)\)$/);
  if (mantine) {
    const scale = theme.colors?.[mantine[1]];
    if (!scale) throw new Error(`Unknown color scale in ${trimmed}`);
    return resolveColor(scale[Number(mantine[2])]);
  }
  const gyt = trimmed.match(/^var\((--gyt-[a-z0-9-]+)\)$/);
  if (gyt && gyt[1] in lightVars) return resolveColor(lightVars[gyt[1]]);
  throw new Error(`Cannot resolve ${trimmed} to a hex color`);
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const findRule = (selector: string) => {
  let found: Rule | undefined;
  css.walkRules((rule) => {
    if (rule.selector === selector) found = rule;
  });
  return found;
};

const declaredTokens = (rule: Rule) => {
  const tokens: Record<string, string> = {};
  rule.each((node) => {
    if (node.type === "decl") tokens[node.prop] = node.value;
  });
  return tokens;
};

describe("Draft Results spine in light mode", () => {
  const studio = findRule(STUDIO_SELECTOR);

  it("has a light-mode studio rule", () => {
    expect(studio, `${STUDIO_SELECTOR} is missing`).toBeDefined();
  });

  it("puts the spine and board on light surfaces, not the navy plate", () => {
    const tokens = declaredTokens(studio!);
    const bg = resolveColor(tokens["--spine-bg"]);
    const cell = resolveColor(tokens["--spine-cell"]);
    expect(bg).not.toBe(resolveColor("var(--gyt-plate)"));
    expect(luminance(bg)).toBeGreaterThan(0.8);
    expect(luminance(cell)).toBeGreaterThan(0.8);
  });

  it("keeps every text token at WCAG AA on the panel and on cells", () => {
    const tokens = declaredTokens(studio!);
    const bg = resolveColor(tokens["--spine-bg"]);
    const cell = resolveColor(tokens["--spine-cell"]);
    for (const name of ["--spine-text", "--spine-dimmed", "--spine-accent"]) {
      const fg = resolveColor(tokens[name]);
      expect(contrast(fg, bg), `${name} on the panel`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    for (const name of ["--spine-text", "--spine-dimmed"]) {
      const fg = resolveColor(tokens[name]);
      expect(contrast(fg, cell), `${name} on a cell`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("styles the spine and board through spine tokens, not plate colors", () => {
    // Only `.spine` defines the dark defaults; every other rule in the spine
    // and board section must read the tokens so the studio override lands.
    const section = css.toString().split("/* Own-turn edge glow")[0];
    const offenders = postcss
      .parse(section)
      .nodes.filter(
        (node): node is Rule =>
          node.type === "rule" && node.selector !== ".spine",
      )
      .flatMap((rule) => {
        const hits: string[] = [];
        rule.walkDecls((decl) => {
          if (
            !decl.prop.startsWith("--") &&
            /--mantine-color-dark-[01]\b|--gyt-plate\)/.test(decl.value)
          ) {
            hits.push(`${rule.selector} { ${decl.prop}: ${decl.value} }`);
          }
        });
        return hits;
      });
    expect(offenders).toEqual([]);
  });
});

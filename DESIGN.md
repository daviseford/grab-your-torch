---
name: Grab Your Torch
description: Fantasy Survivor for friends, broadcast in the Victory Flame identity
colors:
  night-navy: "#071d3a"
  league-blue: "#1177ff"
  signal-cyan: "#18d5f2"
  ember-orange: "#ff5a36"
  victory-gold: "#ffc83d"
  ice-white: "#eaf8ff"
  mist-blue: "#b8d9ee"
  studio-ground: "#f3f8fc"
  studio-panel: "#ffffff"
  studio-panel-2: "#e9f2f9"
  studio-rule: "#cfdde9"
  studio-rule-strong: "#9fb8cc"
  signal-text-light: "#0a9fbf"
  glass-ground: "#051428"
  glass-panel: "#0b2344"
  glass-panel-2: "#0e2b52"
  glass-rule: "#1e3d66"
  glass-rule-strong: "#35588a"
  glass-dimmed: "#8fa9c4"
typography:
  display:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 2rem + 2.5vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.3rem + 2vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  boardTitle:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.12em"
  wordmark:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
  label:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
  numeral:
    fontFamily: "Space Grotesk Variable, Space Grotesk, Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "8px"
  pill: "9999px"
spacing:
  xs: "10px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.league-blue}"
    textColor: "{colors.studio-panel}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "36px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "36px"
  slate-on-plate:
    backgroundColor: "transparent"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.sm}"
    padding: "0 18px"
    height: "36px"
  badge-live:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  badge-watch-along:
    backgroundColor: "{colors.victory-gold}"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  badge-season:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  badge-admin:
    backgroundColor: "{colors.ember-orange}"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  intro-tag:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.ice-white}"
    rounded: "3px"
    padding: "4px 8px"
  board:
    backgroundColor: "{colors.studio-panel}"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.md}"
    padding: "16px"
  plate:
    backgroundColor: "{colors.night-navy}"
    textColor: "{colors.ice-white}"
    rounded: "{rounded.md}"
    padding: "20px"
  rank-block:
    backgroundColor: "{colors.league-blue}"
    textColor: "{colors.studio-panel}"
    rounded: "{rounded.sm}"
    size: "32px"
  rank-block-first:
    backgroundColor: "{colors.victory-gold}"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.sm}"
    size: "32px"
  input:
    backgroundColor: "{colors.studio-panel}"
    textColor: "{colors.night-navy}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
---

# Design System: Grab Your Torch

## Overview

**Creative North Star: "On Air"**

Grab Your Torch is the broadcast of your league. Every surface is a graphics
package laid over the game rather than a dashboard about it: a corner bug with
the lockup and where you are, a lower-third that introduces each page, boards
that carry the data, slates for every control, and the reveal strip that shows
exactly which episodes a group has watched. The identity is the supplied
Victory Flame package (`docs/brand/brand-guidelines.md`); this file records
how the shipped interface uses it.

Two expressions of one package. Dark is Night Navy broadcast glass; light is
the studio, an Ice White ground with navy plates and white boards. Neither is
an inversion of the other: plates stay navy in both, and the scheme changes
the ground, the panels, and the rules. The world is flat ink: no gradients,
no glow, no shadows beyond a hairline, and the emblem is the only
illustration. State is a mark as well as a hue (punched, flagged, dashed,
struck, outlined), so color never carries meaning alone.

**Key Characteristics:**

- Navy plates on a studio ground (light) or glass (dark); white boards hold data.
- League Blue owns primary actions and rank blocks; Signal Cyan is reserved for live and current state.
- Space Grotesk for titles, caps labels, and every number that matters; Inter for everything operated.
- Six components carry the package: bug, lower-third, board, slate, reveal strip, standby slate.
- Density is Operate-mode plain on product and admin surfaces; the homepage is calm and literal.

## Colors

A blue-led broadcast palette with two flame accents held in reserve.

### Primary

- **League Blue** (#1177ff): primary slates, rank blocks, the active era or filter segment, the draft board's own column, links. `--mantine-color-league-6`.
- **Night Navy** (#071d3a): the header plate, season and standby plates, intro tags, season badges, the black of the system (`theme.black`). In dark mode plates lift to Glass Panel (#0b2344).

### Secondary

- **Signal Cyan** (#18d5f2): the signal. Live badges and dots, the current navigation underline, the current draft cell, the revealed cells of the reveal strip, the "you" marker on your own row. As text on the light ground it darkens to #0a9fbf (`--gyt-signal-text`).

### Tertiary

- **Ember Orange** (#ff5a36): the flame. The pick just made, a struck eliminated castaway, the finale ring on the reveal strip, the admin badge, points gained.
- **Victory Gold** (#ffc83d): first place, the next episode's flag, the watch-along badge, the winner.

### Neutral

- **Studio Ground** (#f3f8fc): the light page background (`--mantine-color-body`).
- **Studio Panel** (#ffffff) and **Studio Panel 2** (#e9f2f9): boards and board heads in light.
- **Studio Rule** (#cfdde9) and **Studio Rule Strong** (#9fb8cc): hairlines and control borders in light.
- **Glass Ground** (#051428), **Glass Panel** (#0b2344), **Glass Panel 2** (#0e2b52), **Glass Rule** (#1e3d66), **Glass Rule Strong** (#35588a): the dark scheme's ground, panels, and rules (Mantine's `dark` scale is navy-tinted: dark-7 is the body, dark-6 panels, dark-4 borders).
- **Ice White** (#eaf8ff) and **Mist Blue** (#b8d9ee): text and secondary text on navy; Ice White is the dark scheme's text color (dark-0).
- **Glass Dimmed** (#8fa9c4): dimmed text on glass (dark-2).

Semantic colors stay outside the brand system: Mantine green for success, orange for warnings, red for danger and eliminated strikes' text, and the scoring category palette (blue, teal, yellow, grape, gray) for Challenges, Milestones, Idols, Advantages, and Other.

### Named Rules

**The Signal Rule.** Signal Cyan means live, current, or yours. It never decorates a static label, heading, or section; a cyan element is always telling you where the action is now.

**The Flame Rule.** Ember and Gold are spent only on flame moments: first place, the winner, a fresh pick, an elimination strike, the next episode, the admin mark. Destructive controls use semantic red, never Ember.

**The Plate Rule.** Navy plates stay navy in both schemes and re-point Mantine's text tokens inside them (`--mantine-color-text` to Ice White, `--mantine-color-dimmed` to Mist Blue), so anything placed on a plate reads without per-element color.

## Typography

**Display Font:** Space Grotesk Variable (with Inter Variable, system-ui fallbacks), self-hosted, Latin weight axis 300 to 700.
**Body Font:** Inter Variable (with Inter, system-ui, Segoe UI, Roboto fallbacks), self-hosted, Latin weight axis 100 to 900.
**Label Font:** Space Grotesk Variable, 600 to 700, tracked caps.

**Character:** A geometric grotesk carries the broadcast voice in titles, caps labels, and tabular numerals; Inter keeps forms, tables, and body copy quiet and operable. Both come from version-pinned Fontsource packages and never from a font host.

### Hierarchy

- **Display** (700, clamp(2.75rem, 2rem + 2.5vw, 3.5rem), 1.05): the homepage headline only.
- **Headline** (700, clamp(1.75rem, 1.3rem + 2vw, 2.5rem), 1.08): the page title inside a lower-third; one h1 per page.
- **Title** (700, 1.25rem to 1.75rem, 1.2 to 1.3): section headings (h2, h3) and the standby slate's title.
- **Board title** (700, 0.75rem, 0.12em tracking, uppercase): the caps title row of every board; tabs share the size at 600 and 0.1em tracking.
- **Wordmark** (700, 1rem, 0.02em tracking): the header bug's text wordmark, shown only below 26em where the lockup image would not fit.
- **Body** (400, 0.875rem to 0.9375rem, 1.5 to 1.55): copy and table cells; running text stays under 65ch.
- **Label** (600, 0.6875rem, 0.12em tracking, uppercase): eyebrows, table headers, badges, the bug context, strip labels.
- **Numeral** (700, 1.5rem to 2.5rem, tabular-nums, -0.02em): points, ranks, pick numbers.

### Named Rules

**The Tabular Rule.** Every number that lines up (points, episodes, picks) sets `font-variant-numeric: tabular-nums`; the body sets it globally.

**The One Display Face Rule.** Space Grotesk is the only display voice; it never gets an italic or a second face beside it. The wordmark's italic "Torch" lives in the outlined logo assets, not in page type.

## Layout

Pages sit in Mantine's AppShell under a 60 px header (56 px under 48em) with `md` padding on phones and `lg` from 48em. Content uses the page's own grid: `PageIntro` spans the full width and ends in a hairline rule; boards and panels follow in a single column on phones, two columns on desktop where the approved comp split them (competition overview: 5/12 sticky standings beside 7/12 rosters and scores). Grids of tiles and castaway slates run 6 or 5 columns on desktop, 3 at tablet widths, and 2 on phones.

Breakpoints are Mantine's: xs 36em, sm 48em, md 62em (the navigation collapses into a panel below it), lg 75em, xl 88em. Spacing uses the Mantine scale (xs 10, sm 12, md 16, lg 20, xl 32 px); boards use 16 px internal padding and 10 px head rows; dense admin boards use 6 px row padding at 13 px text. The document never scrolls sideways: wide tables scroll inside `Board scroll`, with sticky identity columns on desktop only.

## Elevation & Depth

Flat. Depth is tonal: ground, panel, and panel-2 steps, navy plates, and 1 px hairlines. Boards carry a single 1 px hairline bottom edge in light (`0 1px 0 rgba(7, 29, 58, 0.06)`) and nothing in dark. No drop shadows, no glow, no blur; modal overlays are a 60% scrim. Motion is bounded to state changes (a pick landing, a turn changing, a reveal) and collapses under `prefers-reduced-motion`.

### Named Rules

**The Flat Ink Rule.** No gradients anywhere in the product; color commits as flat fields that own whole regions.

## Shapes

Hard-cornered slates. The default radius is 4 px (`sm`) for buttons, inputs, badges, rank blocks, and strip cells; boards, plates, and cards use 8 px (`md`); badges use 2 px (`xs`). Avatars are the one circle. Borders are 1 px hairlines in the rule token; empty states and off-air strip cells are dashed rule boxes; the finale cell carries a 2 px inset Ember ring; a picked castaway carries a 3 px inset League Blue outline; an eliminated castaway is desaturated with a 4 px Ember diagonal strike.

## Components

### Bug (`src/AppRoutes.tsx`)

The corner lockup on the navy header plate, 180 px wide (160 px under 62em, the brand minimum), replaced below 26em by the emblem and a typeset wordmark. Beside it, a hairline-divided caps context names the surface (pages set it with `useBugContext`): "Seasons", "S47 · Ep 11 · Watch-along", "S50 · Draft" with the live turn slate, "Admin · S50" with the admin slate. Hidden under 62em.

### Navigation (`src/components/Navbar`)

Caps Space Grotesk links with a 2 px Signal Cyan underline on the current section; the color-scheme toggle as a subtle icon button; Sign in (subtle) and Create account (outline) or the account name and Logout on the navy plate. One landmark: inline on desktop, a panel under the header opened by the burger below 62em, where links stack with a 3 px cyan left mark on the current one.

### Lower-third (`PageIntro`)

Eyebrow tag (navy plate, caps Ice White) plus an optional caps context in Signal Cyan text for live facts, the page h1, a one-line description, a meta row of badges and facts, and right-aligned actions; closed by a hairline rule. Actions stack full width under 48em.

### Board (`Board`)

A white (light) or glass-panel (dark) panel with an 8 px radius, a 1 px rule, a caps title row with an optional muted qualifier and a right-side aside, and a body. `scroll` wraps the body in a local horizontal scroller; `dense` tightens rows; `flush` removes body padding for tables. Table headers are caps labels on panel-2.

### Slates (buttons)

- **Shape:** 4 px radius, 36 px tall at the default size, Inter 600.
- **Primary:** League Blue fill, white text.
- **Secondary:** transparent with a 1 px rule-strong border, text in the page color.
- **On a plate:** `variant="outline" color="dark.0"` (Ice White border and text) for the secondary slate on navy; primary stays League Blue.
- **Destructive:** semantic red, subtle or outline, separated from edit controls on touch screens with 40 px targets.
- **Focus:** a 2 px League Blue outline (Signal Cyan in dark) at 2 px offset, global.

### Status badges (`StatusBadge`)

Caps Space Grotesk 700, 2 px radius. `live` is Signal Cyan with a navy dot; `watch-along` is Victory Gold; `in-progress` and `complete` are outlined; `pending` is a dashed outline; `season` is a navy plate (League Blue in dark); `admin` is Ember.

### Reveal strip (`RevealStrip`)

One cell per episode: revealed cells are Signal Cyan with a punched dot, the next episode is Victory Gold with a folded flag, hidden cells are dashed outlines, the finale carries an Ember ring. Cells become buttons when `onSelect` is given. Rows of seven under 30em. Labeled by a caps row ("Episode reveal", "Through episode 6") and an optional legend.

### Castaway slate (`CastawayCard`)

Portrait on a navy plate (3:4, or square when compact) with an initials plate when no image exists, name in Space Grotesk 700, one meta line, optional tag and marker in the portrait corners, and actions below. `out` desaturates the portrait, strikes the name, and draws the Ember diagonal; `picked` adds the League Blue inset outline.

### Standby slate (`StandbySlate`)

A navy plate, max 520 px, centered, with the dark stacked lockup on top, a small Signal Cyan caps code, one block of content, and an actions row. Used for not found, route errors, signed out, password reset, access denied, and the missing-competition state. Inputs on the plate are white.

### Notice (`Notice`)

A hairline rule box with a caps tone label (Tip, Saved, Unsaved, Merge episode) and body text; the tone lives in the label color only.

### Inputs

Mantine inputs at the 4 px radius with the rule-strong border on white (light) or glass panel (dark); focus uses the global outline. Segmented controls and era rails are caps Space Grotesk with the active segment on a navy plate (League Blue in dark).

## Do's and Don'ts

### Do:

- **Do** open every page with a `PageIntro` and exactly one h1, and keep sections as boards with caps title rows.
- **Do** encode state with a mark as well as a hue: punched, flagged, dashed, struck, outlined.
- **Do** keep wide tables inside `Board scroll`; the document never scrolls horizontally at 375 px.
- **Do** put standby states (errors, auth, not found) on the `StandbySlate` with the dark stacked lockup.
- **Do** use `StatusBadge` kinds for Live, Watch-along, In progress, Complete, Season, and Admin instead of ad hoc badges.
- **Do** keep the homepage free of real competition results; examples use fictional names and points with no season or castaways.

### Don't:

- **Don't** use Signal Cyan for static labels, headings, or decoration; it means live, current, or yours.
- **Don't** spend Ember or Gold outside flame moments, and don't use Ember for destructive controls.
- **Don't** add gradients, glows, drop shadows, tinted alert cards, icon tiles, or illustrations beyond the emblem.
- **Don't** draw thick single-edge accent bars on cards or rows; use a mark, a rank block, or a full outline.
- **Don't** place the primary lockup below 160 px wide or the emblem below 40 px tall; use the favicon artwork below that.
- **Don't** reveal anything past a competition's current episode in any board, strip, or copy, and never name a trade's episode.

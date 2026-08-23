/**
 * Route definitions for e2e tests.
 *
 * IMPORTANT: All e2e tests must be READ-ONLY. Navigate and screenshot only.
 * Never modify production season data.
 */

/** Season ID used for dynamic route parameters */
const SEASON_ID = "season_50";
export type CompetitionTab = "Overview" | "My Team" | "Trades" | "Stats";

export interface AuditRoute {
  path: string;
  name: string;
  competitionTab?: CompetitionTab;
  /** Admin season workspace tab expected to be selected. */
  adminTab?: string;
  /** Heading the page must render (regex or exact text), proving the state. */
  heading?: RegExp | string;
  /** Routes that sign the session out must run in their own context. */
  signsOut?: boolean;
}

/**
 * Competition IDs for detail-page coverage (the signed-in admin account
 * participates in all three, so the My Team tab exists on each):
 * - WATCH_ALONG_COMP: watch-along mode with prop bets ("Amanda and Davis 49")
 * - COMPLETE_COMP: finished live competition with full scoring data ("Ford Family", S46)
 * - TRADE_COMP: watch-along competition with accepted trades ("Trade Tester", S47)
 * Seed fixtures from `yarn seed-competition` are deliberately not used here
 * because their teardown removes them.
 */
const WATCH_ALONG_COMP = "competition_a8f8029f-5134-4c7d-b10e-fd1f9d970bda";
const COMPLETE_COMP = "competition_966233a0-66d9-4500-a134-a085d0532b58";
const TRADE_COMP = "competition_b0a17390-f8ab-4e2a-9f1a-2e715078d2d4";

/** Routes that don't require authentication */
export const PUBLIC_ROUTES: AuditRoute[] = [
  { path: "/", name: "home", heading: /Grab your torch/ },
  { path: "/seasons", name: "seasons", heading: "Pick a season" },
  { path: `/seasons/${SEASON_ID}`, name: "single-season" },
  { path: "/scoring", name: "scoring" },
  {
    path: "/this-page-does-not-exist",
    name: "not-found",
    heading: "Page not found",
  },
  {
    path: "/reset-password",
    name: "reset-password-returned",
    heading: "Sign in with your new password",
  },
  {
    path: "/logout",
    name: "logout",
    heading: "You're signed out",
    signsOut: true,
  },
];

const competitionTabs = (
  id: string,
  prefix: string,
  tabs: Array<[string, CompetitionTab]>,
): AuditRoute[] =>
  tabs.map(([param, tab]) => ({
    path: `/competitions/${id}?tab=${param}`,
    name: `${prefix}-${param}`,
    competitionTab: tab,
  }));

/** Routes that require admin authentication */
export const ADMIN_ROUTES: AuditRoute[] = [
  { path: "/admin", name: "admin-dashboard", heading: "Admin" },
  { path: `/admin/${SEASON_ID}`, name: "season-admin", adminTab: "Episodes" },
  {
    path: `/admin/${SEASON_ID}?tab=events`,
    name: "season-admin-events",
    adminTab: "Events",
  },
  {
    path: `/admin/${SEASON_ID}?tab=challenges`,
    name: "season-admin-challenges",
    adminTab: "Challenges",
  },
  {
    path: `/admin/${SEASON_ID}?tab=eliminations`,
    name: "season-admin-eliminations",
    adminTab: "Eliminations",
  },
  {
    path: `/admin/${SEASON_ID}?tab=teams`,
    name: "season-admin-teams",
    adminTab: "Teams",
  },
  { path: "/competitions", name: "competitions", heading: "Competitions" },
  ...competitionTabs(WATCH_ALONG_COMP, "competition-watch-along", [
    ["overview", "Overview"],
    ["team", "My Team"],
    ["trades", "Trades"],
    ["stats", "Stats"],
  ]),
  ...competitionTabs(COMPLETE_COMP, "competition-complete", [
    ["overview", "Overview"],
    ["team", "My Team"],
    ["trades", "Trades"],
    ["stats", "Stats"],
  ]),
  ...competitionTabs(TRADE_COMP, "competition-trades", [
    ["overview", "Overview"],
    ["team", "My Team"],
    ["trades", "Trades"],
  ]),
];

/** All routes combined */
export const ALL_ROUTES = [...PUBLIC_ROUTES, ...ADMIN_ROUTES];

/**
 * Sections to scroll-capture on content-rich pages.
 * Each entry defines a page name and DOM selectors for key sections.
 * The audit spec scrolls to each section and takes a focused screenshot.
 */
const OVERVIEW_SECTIONS = [
  { label: "header", selector: "h1" },
  { label: "standings", selector: "h3:has-text('Standings')" },
  { label: "rosters", selector: "h3:has-text('Rosters')" },
  { label: "prop-bets", selector: "h3:has-text('Prop Bets')" },
  { label: "player-scores", selector: "h3:has-text('Player Scores')" },
  {
    label: "scoring-reference",
    selector: "h4:has-text('Scoring Reference')",
  },
];

export const SCROLL_SECTIONS: Record<
  string,
  { label: string; selector: string }[]
> = {
  "competition-watch-along-overview": OVERVIEW_SECTIONS,
  "competition-watch-along-trades": [
    { label: "trades", selector: "h3:has-text('Trades')" },
  ],
  "competition-watch-along-stats": [
    { label: "season-stats", selector: "h3:has-text('Season Stats')" },
  ],
  "competition-complete-overview": OVERVIEW_SECTIONS,
  "competition-complete-trades": [
    { label: "trades", selector: "h3:has-text('Trades')" },
  ],
  "competition-complete-stats": [
    { label: "season-stats", selector: "h3:has-text('Season Stats')" },
  ],
  "competition-trades-overview": OVERVIEW_SECTIONS,
  "competition-trades-trades": [
    { label: "trades", selector: "h3:has-text('Trades')" },
  ],
};

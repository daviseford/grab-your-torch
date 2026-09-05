/**
 * Pre-premiere cast bootstrap from the Survivor Wiki.
 *
 * survivoR is the authoritative data source, but it only publishes a season
 * once episodes start airing. CBS announces the cast a few weeks earlier, and
 * the wiki's season page carries the full castaway table by then. This module
 * reads that table and shapes it like survivoR `castaways.json` rows so the
 * rest of the pipeline (transformPlayers, codegen, Firestore push) runs
 * unchanged.
 *
 * castaway_ids assigned here are PROVISIONAL. survivoR numbers new castaways
 * sequentially after the highest existing id, ordered alphabetically by
 * full_name (case-insensitive); seasons 47, 48 and 49 all follow that rule.
 * `validateSeasonData` refuses to overwrite a season whose ids no longer match
 * once survivoR publishes the real data, so a wrong guess fails loudly instead
 * of silently re-pointing drafted rosters at the wrong people.
 */

import type { SurvivorCastaway } from "./survivor-types.js";
import { fetchWikitext, getSeasonPageName } from "./wiki-api.js";

/** One row of the wiki season page's Castaways table. */
export interface WikiCastMember {
  fullName: string;
  age?: number;
  /** "City, Full State Name" (abbreviations expanded to match survivoR). */
  hometown?: string;
  occupation?: string;
}

const REGION_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
  // Canadian provinces (open casting since season 47)
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
};

/**
 * Split "Providence, RI" into survivoR-style city and state.
 * Unknown or missing abbreviations are passed through untouched.
 */
export function splitHometown(raw: string): {
  city: string;
  state: string | null;
} {
  const idx = raw.lastIndexOf(",");
  if (idx === -1) return { city: raw.trim(), state: null };
  const city = raw.slice(0, idx).trim();
  const region = raw.slice(idx + 1).trim();
  if (region === "DC") return { city: "Washington", state: "D.C." };
  return { city, state: REGION_NAMES[region] ?? region };
}

/** Strip <ref>...</ref>, {{nowrap|...}} and bold/italic markup. */
function clean(value: string): string {
  return value
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/\{\{nowrap\|([\s\S]*?)\}\}/gi, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Parse the `==Castaways==` table on a wiki season page.
 *
 * Each row looks like:
 *   | {{tribebox2|}}[[File:S51 aaliyah t.png|70px|link=Aaliyah Puglia]]
 *   | align="left"| '''[[Aaliyah Puglia]]'''<br /><small>24, Providence, RI<br />Chef</small>
 */
export function parseWikiCastTable(wikitext: string): WikiCastMember[] {
  const start = wikitext.search(/^==\s*Castaways\s*==/m);
  if (start === -1) return [];
  const rest = wikitext.slice(start);
  const end = rest.indexOf("\n|}");
  const table = end === -1 ? rest : rest.slice(0, end);

  const members: WikiCastMember[] = [];
  for (const row of table.split(/^\|-/m)) {
    // The name is the bold wikilink in the contestant cell. Fall back to the
    // portrait's link= target when the cell is formatted unusually.
    const nameMatch =
      row.match(/'''\s*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\s*'''/) ??
      row.match(/\|\s*link=([^\]|]+)\]\]/);
    if (!nameMatch) continue;
    // Piped links ([[Page (Survivor)|Display]]) show the name survivoR uses.
    const fullName = clean(nameMatch[2] || nameMatch[1]);
    if (!fullName) continue;

    const member: WikiCastMember = { fullName };

    const small = row.match(/<small>([\s\S]*?)<\/small>/i);
    if (small) {
      const parts = clean(small[1])
        .split(/<br\s*\/?>/i)
        .map((p) => p.trim())
        .filter(Boolean);
      // "24, Providence, RI"
      const first = parts[0] ?? "";
      const ageMatch = first.match(/^(\d{1,3}),\s*(.*)$/);
      if (ageMatch) {
        member.age = Number(ageMatch[1]);
        if (ageMatch[2]) member.hometown = ageMatch[2];
      } else if (first) {
        member.hometown = first;
      }
      if (parts[1]) member.occupation = parts[1];
    }

    members.push(member);
  }
  return members;
}

/** Fetch and parse the cast table for a season from the Survivor Wiki. */
export async function fetchWikiCast(
  seasonNum: number,
): Promise<WikiCastMember[]> {
  const wikitext = await fetchWikitext(getSeasonPageName(seasonNum));
  if (!wikitext) return [];
  return parseWikiCastTable(wikitext);
}

const CASTAWAY_ID_PATTERN = /^US(\d{4})$/;

/** The id survivoR would assign next: one past the highest existing US id. */
export function nextCastawayId(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const m = CASTAWAY_ID_PATTERN.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatCastawayId(max + 1);
}

function formatCastawayId(n: number): string {
  return `US${String(n).padStart(4, "0")}`;
}

/**
 * Shape wiki cast rows as survivoR castaways with provisional ids.
 *
 * Ids run sequentially from `firstId` in case-insensitive alphabetical order
 * of full_name, matching how survivoR has numbered every recent new cast.
 * Returning players (already in survivoR) keep their real id when the caller
 * supplies `knownIds` keyed by full_name.
 */
export function buildProvisionalCastaways(
  cast: WikiCastMember[],
  seasonNum: number,
  firstId: string,
  knownIds: ReadonlyMap<string, string> = new Map(),
): SurvivorCastaway[] {
  const firstMatch = CASTAWAY_ID_PATTERN.exec(firstId);
  if (!firstMatch) {
    throw new Error(`Invalid first castaway id "${firstId}"`);
  }
  let next = Number(firstMatch[1]);

  const sorted = [...cast].sort((a, b) => {
    const x = a.fullName.toLowerCase();
    const y = b.fullName.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  return sorted.map((member, index) => {
    const known = knownIds.get(member.fullName);
    const castawayId = known ?? formatCastawayId(next++);
    const { city, state } = member.hometown
      ? splitHometown(member.hometown)
      : { city: null, state: null };

    return {
      version: "US",
      version_season: `US${String(seasonNum).padStart(2, "0")}`,
      season: seasonNum,
      full_name: member.fullName,
      castaway_id: castawayId,
      castaway: member.fullName.split(" ")[0],
      age: member.age ?? null,
      city,
      state,
      episode: 0,
      day: null,
      order: index + 1,
      result: "",
      place: 0,
      original_tribe: "",
      jury: false,
      finalist: false,
      winner: false,
    };
  });
}

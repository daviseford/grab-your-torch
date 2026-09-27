/**
 * Keeps the curated cast of a committed season file across the unattended
 * survivoR sync.
 *
 * survivoR only carries a castaway's id, name, short name, age and city/state.
 * People fill in the rest by hand (professions, bios, images, nicknames) and
 * sometimes correct what survivoR does carry. The sync used to rebuild the
 * cast from survivoR alone, keeping only images, then auto-merge the result,
 * so every curated field was silently lost on the next episode.
 *
 * Field authority, applied per castaway already in the committed file:
 * - castaway_id and full_name come from survivoR. validateSeasonData already
 *   refuses an id change and reports a rename.
 * - Every other field keeps its committed value. survivoR only fills a field
 *   the committed castaway does not have. When survivoR disagrees with a
 *   committed value, the committed value stays and the difference is
 *   reported so a person can decide. A blank is indistinguishable from a
 *   deleted field, so deleting a field survivoR carries does not stick.
 * A castaway survivoR adds that the file does not have yet is written from
 * survivoR, after the committed castaways.
 */

import ts from "typescript";
import {
  detectImgConstant,
  generateFullSeasonFile,
  mergeScrapedPlayers,
  type MergedPlayer,
} from "./codegen.js";
import type { ScrapeResult, ScrapeResultsOutput } from "./types.js";

/** Player fields in a season file, mapped to the MergedPlayer key they fill. */
const PLAYER_FIELDS = {
  castaway_id: "castawayId",
  full_name: "fullName",
  img: "img",
  description: "description",
  age: "age",
  profession: "profession",
  hometown: "hometown",
  previousSeasons: "previousSeasons",
  nickname: "nickname",
  gender: "gender",
  bio: "bio",
} as const satisfies Record<string, keyof MergedPlayer>;

/** Fields that keep their committed value; the rest come from survivoR. */
const CURATED_KEYS = [
  "castawayShortName",
  "img",
  "description",
  "age",
  "profession",
  "hometown",
  "previousSeasons",
  "nickname",
  "gender",
  "bio",
] as const satisfies readonly (keyof MergedPlayer)[];

type FieldValue = string | number | number[];

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isSatisfiesExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const findExport = (
  source: ts.SourceFile,
  name: string,
): ts.Expression | undefined => {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name) {
        return decl.initializer && unwrap(decl.initializer);
      }
    }
  }
  return undefined;
};

const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

/** Read a literal value, or refuse: an unreadable value must not be dropped. */
const readValue = (
  node: ts.Expression,
  imgPrefix: string | undefined,
  where: string,
): FieldValue => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isTemplateExpression(node) &&
    imgPrefix !== undefined &&
    node.templateSpans.every(
      (span) =>
        ts.isIdentifier(span.expression) && span.expression.text === "IMG",
    )
  ) {
    return (
      node.head.text +
      node.templateSpans.map((span) => imgPrefix + span.literal.text).join("")
    );
  }
  if (
    ts.isArrayLiteralExpression(node) &&
    node.elements.every(ts.isNumericLiteral)
  ) {
    return node.elements.map((e) => Number((e as ts.NumericLiteral).text));
  }
  throw new Error(
    `${where} is not a plain literal the survivoR sync can carry over; make it one or teach scripts/lib/curated-cast.ts to read it`,
  );
};

/**
 * Read every castaway of SEASON_XX_PLAYERS (with its short name from
 * SEASON_XX_CASTAWAY_LOOKUP) as committed. Throws, rather than dropping data,
 * on any field or value it cannot carry over.
 */
export function readCommittedCast(
  fileContent: string,
  seasonNum: number,
): MergedPlayer[] {
  const source = ts.createSourceFile(
    `season_${seasonNum}.ts`,
    fileContent,
    ts.ScriptTarget.Latest,
    true,
  );
  const imgPrefix = detectImgConstant(fileContent)?.prefix;

  const shortNames = new Map<string, string>();
  const lookup = findExport(source, `SEASON_${seasonNum}_CASTAWAY_LOOKUP`);
  if (lookup && ts.isObjectLiteralExpression(lookup)) {
    for (const prop of lookup.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const id = propertyName(prop.name);
      const entry = unwrap(prop.initializer);
      if (!id || !ts.isObjectLiteralExpression(entry)) continue;
      for (const field of entry.properties) {
        if (
          ts.isPropertyAssignment(field) &&
          propertyName(field.name) === "castaway"
        ) {
          const value = readValue(
            unwrap(field.initializer),
            imgPrefix,
            `${id}.castaway`,
          );
          if (typeof value === "string") shortNames.set(id, value);
        }
      }
    }
  }

  const players = findExport(source, `SEASON_${seasonNum}_PLAYERS`);
  if (!players || !ts.isArrayLiteralExpression(players)) {
    throw new Error(
      `SEASON_${seasonNum}_PLAYERS is not an array literal; the survivoR sync cannot tell which cast fields are curated`,
    );
  }

  return players.elements.map((element, index) => {
    const call = unwrap(element as ts.Expression);
    const arg =
      ts.isCallExpression(call) && call.arguments.length === 1
        ? unwrap(call.arguments[0])
        : undefined;
    if (!arg || !ts.isObjectLiteralExpression(arg)) {
      throw new Error(
        `SEASON_${seasonNum}_PLAYERS[${index}] is not buildPlayer({ ... }); the survivoR sync only carries over object-style castaways`,
      );
    }

    const fields: Partial<Record<keyof MergedPlayer, FieldValue>> = {};
    for (const prop of arg.properties) {
      const key = ts.isPropertyAssignment(prop)
        ? propertyName(prop.name)
        : undefined;
      if (!key || !Object.hasOwn(PLAYER_FIELDS, key)) {
        throw new Error(
          `SEASON_${seasonNum}_PLAYERS[${index}] has "${prop.getText(source)}", which the survivoR sync would drop; add the field to scripts/lib/curated-cast.ts and the codegen first`,
        );
      }
      const target = PLAYER_FIELDS[key as keyof typeof PLAYER_FIELDS];
      fields[target] = readValue(
        unwrap((prop as ts.PropertyAssignment).initializer),
        imgPrefix,
        `SEASON_${seasonNum}_PLAYERS[${index}].${key}`,
      );
    }

    const castawayId = fields.castawayId;
    const fullName = fields.fullName;
    if (typeof castawayId !== "string" || typeof fullName !== "string") {
      throw new Error(
        `SEASON_${seasonNum}_PLAYERS[${index}] has no castaway_id or full_name`,
      );
    }
    return {
      ...fields,
      castawayId,
      fullName,
      img: typeof fields.img === "string" ? fields.img : "",
      castawayShortName: shortNames.get(castawayId) ?? fullName.split(" ")[0],
    } as MergedPlayer;
  });
}

const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export interface CastMergeResult {
  cast: MergedPlayer[];
  /** Committed values survivoR disagrees with; each one was kept. */
  keptDifferences: string[];
}

/**
 * Apply the field authority described at the top of this file. `fromSource`
 * is the cast as survivoR alone would write it; `committed` is what
 * readCommittedCast found in the file.
 */
export function keepCuratedCast(
  fromSource: MergedPlayer[],
  committed: MergedPlayer[],
): CastMergeResult {
  const sourceById = new Map(fromSource.map((p) => [p.castawayId, p]));
  const committedIds = new Set(committed.map((p) => p.castawayId));
  const keptDifferences: string[] = [];

  // Committed castaways survivoR no longer has are left out here; validation
  // fails the sync on them before anything is written.
  const kept = committed
    .filter((c) => sourceById.has(c.castawayId))
    .map((c) => {
      const fromSurvivor = sourceById.get(c.castawayId)!;
      const merged: MergedPlayer = { ...fromSurvivor };
      for (const key of CURATED_KEYS) {
        const committedValue = c[key];
        const sourceValue = fromSurvivor[key];
        if (isBlank(committedValue)) continue;
        (merged as unknown as Record<string, unknown>)[key] = committedValue;
        // description is built from the fields around it, so a difference
        // there only repeats one already reported.
        if (
          key !== "description" &&
          !isBlank(sourceValue) &&
          !sameValue(committedValue, sourceValue)
        ) {
          keptDifferences.push(
            `${c.castawayId} ${c.fullName}: kept ${key} ${JSON.stringify(committedValue)}; survivoR has ${JSON.stringify(sourceValue)}`,
          );
        }
      }
      return merged;
    });

  const added = fromSource.filter((p) => !committedIds.has(p.castawayId));
  return { cast: [...kept, ...added], keptDifferences };
}

/** The `//` comment lines a file opens with, if any. */
export const leadingComment = (fileContent: string): string =>
  /^(?:\/\/[^\n]*\n)+/.exec(fileContent)?.[0] ?? "";

/**
 * The season file the sync writes: the committed cast (see the field
 * authority above) plus freshly generated episode, challenge, elimination,
 * event and vote history exports. Without a committed file, the cast comes
 * from survivoR alone.
 */
export function regenerateSeasonFile(
  existingContent: string | undefined,
  playerData: ScrapeResult,
  resultsData: ScrapeResultsOutput,
  seasonNum: number,
): { content: string; keptDifferences: string[] } {
  if (existingContent === undefined) {
    return {
      content: generateFullSeasonFile(playerData, resultsData, seasonNum),
      keptDifferences: [],
    };
  }

  const { cast, keptDifferences } = keepCuratedCast(
    mergeScrapedPlayers(playerData.players, []),
    readCommittedCast(existingContent, seasonNum),
  );
  const content =
    leadingComment(existingContent) +
    generateFullSeasonFile(playerData, resultsData, seasonNum, undefined, {
      cast,
      imgConstant: detectImgConstant(existingContent),
    });
  return { content, keptDifferences };
}

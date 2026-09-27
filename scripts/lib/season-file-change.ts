/**
 * Decide whether a regenerated season file differs from the committed one.
 *
 * The codegen writes its own layout (quoted keys, expanded arrays), and the
 * committed file is Prettier's layout, because the sync workflow runs
 * `yarn format` before it commits. Comparing the raw codegen output against
 * the committed file therefore always reported a change, and every no-op
 * nightly run re-pushed the season to Firestore. Formatting first makes the
 * comparison about data, and writing the formatted text keeps the file on
 * disk identical to what the workflow would commit.
 */

import * as prettier from "prettier";

export async function formatSeasonSource(
  content: string,
  filePath: string,
): Promise<string> {
  return prettier.format(content, {
    ...(await prettier.resolveConfig(filePath)),
    filepath: filePath,
  });
}

export async function planSeasonFileWrite(
  existingContent: string | undefined,
  generatedContent: string,
  filePath: string,
): Promise<{ content: string; unchanged: boolean }> {
  const content = await formatSeasonSource(generatedContent, filePath);
  return { content, unchanged: existingContent === content };
}

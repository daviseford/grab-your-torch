/**
 * A deterministic, synchronous, dependency-free content hash.
 *
 * Three parties in two runtimes have to agree on the revisions built from
 * this -- the Node season push, every admin CRUD path in the browser, and the
 * recompute job -- and a mismatch fails silently in both directions, so the
 * computation lives in exactly one place and is imported rather than
 * re-described.
 *
 * It is a cache-staleness signal, not a security primitive, so a fast
 * non-cryptographic hash is the right tool. It must be synchronous because
 * `crypto.subtle` is async in the browser.
 *
 * This module deliberately imports nothing: `scripts/generate-scoring-revision.ts`
 * uses it to produce `src/data/scoringRevision.generated.ts`, so anything it
 * reached would have to exist before that file is generated.
 */

/**
 * Deterministic JSON with sorted object keys.
 *
 * Firestore does not preserve key insertion order, so an unsorted
 * `JSON.stringify` would report a spurious change every time a document
 * round-tripped. `undefined` values are dropped, matching Firestore, where an
 * absent field and a deleted field are the same thing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";

  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value) ? String(value) : "null";
  if (kind === "boolean") return String(value);
  if (kind === "string") return JSON.stringify(value);
  if (kind === "bigint") return JSON.stringify(String(value));

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (kind === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }

  // Functions and symbols never appear in season data.
  return JSON.stringify(String(value));
}

/** FNV-1a, one 32-bit lane. */
function fnv1a(input: string, offsetBasis: number): number {
  let hash = offsetBasis;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, in 32-bit arithmetic that stays exact.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const toHex8 = (n: number) => n.toString(16).padStart(8, "0");

/**
 * A 64-bit hex digest, computed as two independently seeded FNV-1a lanes.
 * One 32-bit lane collides too readily over a season's worth of documents.
 */
export function contentHash(input: string): string {
  return toHex8(fnv1a(input, 0x811c9dc5)) + toHex8(fnv1a(input, 0x7fffffff));
}

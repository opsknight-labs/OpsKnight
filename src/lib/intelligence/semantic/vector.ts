/** Pure vector helpers for semantic search. Vectors are stored unit-length so cosine is a dot product. */

export const MIN_DIMENSIONS = 8;
export const MAX_DIMENSIONS = 4096;

/** Unit-length copy of `vector`, or null when it is empty, too large, non-finite or all zeros. */
export function normalizeVector(vector: readonly number[]): number[] | null {
  if (vector.length < MIN_DIMENSIONS || vector.length > MAX_DIMENSIONS) return null;
  let sum = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) return null;
    sum += value * value;
  }
  if (sum === 0) return null;
  const length = Math.sqrt(sum);
  return vector.map(value => value / length);
}

/** Dot product of equal-length vectors; 0 when the shapes differ, so mismatched models never match. */
export function dot(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a.at(i) ?? 0) * (b.at(i) ?? 0);
  return sum;
}

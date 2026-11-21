/**
 * Shared machinery for the offline, suggest-only weight fits (cause ranking, runbook ranking). Pure: no I/O,
 * so the fits are deterministic and unit-testable on labelled fixtures.
 */

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Implicit labels (a rollback after an incident, a cause or runbook named in a postmortem) are inferred, not
 * stated, so they count for this fraction of an explicit verdict in both the loss and the support guard.
 */
export const IMPLICIT_LABEL_WEIGHT = 0.5;

const weightOf = (row: { weight?: number }) => row.weight ?? 1;

/** Weighted mean negative log-likelihood of `rows` under `predict` (rows without a weight count 1). */
export function logLoss<R extends { helpful: boolean; weight?: number }, W>(
  rows: readonly R[],
  weights: W,
  predict: (row: R, weights: W) => number
): number {
  let total = 0;
  let mass = 0;
  for (const row of rows) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, predict(row, weights)));
    total -= weightOf(row) * Math.log(row.helpful ? p : 1 - p);
    mass += weightOf(row);
  }
  return mass ? total / mass : 0;
}

/**
 * Coordinate descent over bounded moves with a shrinking step. Each move returns a new (already clamped)
 * weight set; a move is kept only when it lowers the training loss. Bounded work: 3 steps x 10 passes x
 * moves x 2 evaluations.
 */
export function coordinateDescent<W>(
  initial: W,
  moves: ReadonlyArray<(weights: W, delta: number) => W>,
  loss: (weights: W) => number
): W {
  let weights = initial;
  for (const step of [0.1, 0.05, 0.02]) {
    for (let pass = 0; pass < 10; pass += 1) {
      let improved = false;
      for (const move of moves) {
        const current = loss(weights);
        for (const delta of [step, -step]) {
          const next = move(weights, delta);
          if (loss(next) < current - 1e-6) {
            weights = next;
            improved = true;
            break;
          }
        }
      }
      if (!improved) break;
    }
  }
  return weights;
}

/** Every fifth row is held out; the rest train. Deterministic, so a proposal id is reproducible. */
export function holdOutSplit<R>(rows: readonly R[]): { train: R[]; held: R[] } {
  return {
    train: rows.filter((_, i) => i % 5 !== 0),
    held: rows.filter((_, i) => i % 5 === 0),
  };
}

/** The minimum-sample guard every fit shares: enough rows and enough of each verdict. */
export function hasMinimumSupport(
  rows: ReadonlyArray<{ helpful: boolean; weight?: number }>,
  minimum: { rows: number; perVerdict: number }
): boolean {
  let helpful = 0;
  let total = 0;
  for (const row of rows) {
    total += weightOf(row);
    if (row.helpful) helpful += weightOf(row);
  }
  return (
    total >= minimum.rows && helpful >= minimum.perVerdict && total - helpful >= minimum.perVerdict
  );
}

/**
 * Shared machinery for the offline, suggest-only weight fits (cause ranking, runbook ranking). Pure: no I/O,
 * so the fits are deterministic and unit-testable on labelled fixtures.
 */

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Mean negative log-likelihood of `rows` under `predict`. */
export function logLoss<R extends { helpful: boolean }, W>(
  rows: readonly R[],
  weights: W,
  predict: (row: R, weights: W) => number
): number {
  return (
    rows.reduce((sum, row) => {
      const p = Math.max(1e-6, Math.min(1 - 1e-6, predict(row, weights)));
      return sum - Math.log(row.helpful ? p : 1 - p);
    }, 0) / rows.length
  );
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
  rows: ReadonlyArray<{ helpful: boolean }>,
  minimum: { rows: number; perVerdict: number }
): boolean {
  const helpful = rows.filter(row => row.helpful).length;
  return (
    rows.length >= minimum.rows &&
    helpful >= minimum.perVerdict &&
    rows.length - helpful >= minimum.perVerdict
  );
}

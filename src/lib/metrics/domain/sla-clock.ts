import { intervalDurationMs, intersectInterval, type TimeInterval } from './interval';

export type SlaPause = { startedAt: Date; endedAt: Date | null };

export function effectiveElapsedMs(input: {
  startedAt: Date;
  evaluationAt: Date;
  pauses?: SlaPause[];
}): number {
  const { startedAt, evaluationAt, pauses = [] } = input;
  if (evaluationAt <= startedAt) return 0;
  const window = { start: startedAt, end: evaluationAt };
  const pausedMs = intervalDurationMs(
    pauses
      .map(pause =>
        intersectInterval({ start: pause.startedAt, end: pause.endedAt ?? evaluationAt }, window)
      )
      .filter((pause): pause is TimeInterval => pause !== null)
  );
  return Math.max(0, evaluationAt.getTime() - startedAt.getTime() - pausedMs);
}

export function effectiveMaterializedElapsedMs(input: {
  startedAt: Date;
  evaluationAt: Date;
  pausedMs?: bigint | number | null;
  pauseStartedAt?: Date | null;
}): number {
  const elapsedWithOpenPause = effectiveElapsedMs({
    startedAt: input.startedAt,
    evaluationAt: input.evaluationAt,
    pauses: input.pauseStartedAt ? [{ startedAt: input.pauseStartedAt, endedAt: null }] : [],
  });
  const closedPauseMs =
    typeof input.pausedMs === 'bigint'
      ? Number(
          input.pausedMs > BigInt(Number.MAX_SAFE_INTEGER)
            ? Number.MAX_SAFE_INTEGER
            : input.pausedMs
        )
      : (input.pausedMs ?? 0);
  return Math.max(0, elapsedWithOpenPause - Math.max(0, closedPauseMs));
}

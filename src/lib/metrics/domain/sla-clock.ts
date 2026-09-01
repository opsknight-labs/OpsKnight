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

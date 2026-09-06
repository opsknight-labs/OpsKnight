import type { OnCallBlock } from '@/lib/oncall';

export type OverrideStatus = 'ACTIVE' | 'UPCOMING' | 'COMPLETED';
export type OverrideKind = 'REPLACEMENT' | 'ADDITIVE';

export type ScheduleOverridePresentation = {
  id: string;
  start: Date;
  end: Date;
  userId: string;
  replacesUserId: string | null;
  status: OverrideStatus;
  kind: OverrideKind;
};

export type ScheduleDetailViewModel = {
  currentCoverage: OnCallBlock[];
  nextCoverageChange: {
    at: Date;
    coverage: OnCallBlock[];
  } | null;
  nextCoverage: OnCallBlock | null;
  activeOverrides: ScheduleOverridePresentation[];
  upcomingOverrides: ScheduleOverridePresentation[];
  completedOverrides: ScheduleOverridePresentation[];
  coverageGap: boolean;
  participantCount: number;
  layerCount: number;
  summary: string;
};

type OverrideInput = {
  id: string;
  start: Date;
  end: Date;
  userId: string;
  replacesUserId: string | null;
};

type ScheduleDetailViewModelInput = {
  now: Date;
  finalCoverageBlocks: OnCallBlock[];
  overrides: OverrideInput[];
  layerCount: number;
  participantIds: string[];
};

export function classifyOverride(
  override: Pick<OverrideInput, 'start' | 'end'>,
  now: Date
): OverrideStatus {
  if (override.end.getTime() <= now.getTime()) return 'COMPLETED';
  if (override.start.getTime() > now.getTime()) return 'UPCOMING';
  return 'ACTIVE';
}

export function getOverrideKind(override: Pick<OverrideInput, 'replacesUserId'>): OverrideKind {
  return override.replacesUserId ? 'REPLACEMENT' : 'ADDITIVE';
}

function activeAt(blocks: OnCallBlock[], instant: Date): OnCallBlock[] {
  const time = instant.getTime();
  return blocks.filter(block => block.start.getTime() <= time && block.end.getTime() > time);
}

function coverageIdentity(blocks: OnCallBlock[]): string {
  return blocks
    .map(block => `${block.userId}:${block.source}:${Boolean(block.isAdditiveOverride)}`)
    .sort()
    .join('|');
}

function findNextCoverageChange(blocks: OnCallBlock[], now: Date) {
  const currentIdentity = coverageIdentity(activeAt(blocks, now));
  const boundaries = Array.from(
    new Set(
      blocks
        .flatMap(block => [block.start.getTime(), block.end.getTime()])
        .filter(time => time > now.getTime())
    )
  ).sort((a, b) => a - b);

  for (const boundary of boundaries) {
    const at = new Date(boundary);
    const coverage = activeAt(blocks, at);
    if (coverageIdentity(coverage) !== currentIdentity) return { at, coverage };
  }
  return null;
}

export function buildScheduleDetailViewModel({
  now,
  finalCoverageBlocks,
  overrides,
  layerCount,
  participantIds,
}: ScheduleDetailViewModelInput): ScheduleDetailViewModel {
  const currentCoverage = activeAt(finalCoverageBlocks, now);
  const nextCoverageChange = findNextCoverageChange(finalCoverageBlocks, now);
  const nextCoverage =
    finalCoverageBlocks
      .filter(block => block.start.getTime() > now.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
  const presentedOverrides = overrides.map(override => ({
    ...override,
    status: classifyOverride(override, now),
    kind: getOverrideKind(override),
  }));
  const participantCount = new Set(participantIds).size;
  const coverageGap = currentCoverage.length === 0;

  return {
    currentCoverage,
    nextCoverageChange,
    nextCoverage,
    activeOverrides: presentedOverrides.filter(override => override.status === 'ACTIVE'),
    upcomingOverrides: presentedOverrides.filter(override => override.status === 'UPCOMING'),
    completedOverrides: presentedOverrides.filter(override => override.status === 'COMPLETED'),
    coverageGap,
    participantCount,
    layerCount,
    summary: coverageGap
      ? nextCoverage
        ? `Coverage resumes with ${nextCoverage.userName}`
        : 'No effective coverage is scheduled'
      : currentCoverage.length === 1
        ? `${currentCoverage[0].userName} is on call`
        : `${currentCoverage.length} responders are on call`,
  };
}

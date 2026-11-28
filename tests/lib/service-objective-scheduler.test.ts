import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getObjectiveSnapshotPeriod,
  isPartialObjectiveWindow,
  measurementStartedAt,
  processServiceObjectiveSnapshots,
} from '@/jobs/service-objective-scheduler';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    serviceObjective: { findMany: mocks.findMany },
    serviceObjectiveSnapshot: { upsert: mocks.upsert },
  },
}));
vi.mock('@/lib/slo/evaluator', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/slo/evaluator')>()),
  evaluateServiceObjective: mocks.evaluate,
}));

describe('service objective snapshot periods', () => {
  const dayEnd = new Date('2026-09-19T00:00:00.000Z');

  it('evaluates the configured objective window instead of one day', () => {
    expect(
      getObjectiveSnapshotPeriod(
        {
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
          activeTo: null,
        },
        dayEnd
      )
    ).toEqual({
      periodStart: new Date('2026-08-20T00:00:00.000Z'),
      periodEnd: dayEnd,
    });
  });

  it('clips evaluation to version activation boundaries', () => {
    expect(
      getObjectiveSnapshotPeriod(
        {
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-09-18T12:00:00.000Z'),
          activeTo: new Date('2026-09-18T18:00:00.000Z'),
        },
        dayEnd
      )
    ).toEqual({
      periodStart: new Date('2026-09-18T12:00:00.000Z'),
      periodEnd: new Date('2026-09-18T18:00:00.000Z'),
    });
  });

  it('anchors a retired revision window at its retirement time', () => {
    expect(
      getObjectiveSnapshotPeriod(
        {
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
          activeTo: new Date('2026-09-18T18:00:00.000Z'),
        },
        dayEnd
      )
    ).toEqual({
      periodStart: new Date('2026-08-19T18:00:00.000Z'),
      periodEnd: new Date('2026-09-18T18:00:00.000Z'),
    });
  });
});

type Version = Parameters<typeof measurementStartedAt>[0];
const version = (n: number, overrides: Partial<Version> = {}): Version => ({
  version: n,
  target: 99.9,
  comparator: 'GREATER_THAN_OR_EQUAL',
  windowType: 'THIRTY_DAYS',
  windowValue: null,
  activeFrom: new Date(Date.UTC(2026, 0, n)),
  ...overrides,
});

describe('measurementStartedAt', () => {
  it('does not restart the window when only the name or description changed', () => {
    const history = [version(1), version(2), version(3)];
    expect(measurementStartedAt(history[2], history)).toEqual(version(1).activeFrom);
  });

  it('restarts at the version that changed the target, comparator or window', () => {
    const history = [version(1), version(2, { target: 99.5 }), version(3, { target: 99.5 })];
    expect(measurementStartedAt(history[2], history)).toEqual(version(2).activeFrom);
    const longer = [version(1), version(2, { windowType: 'NINETY_DAYS' })];
    expect(measurementStartedAt(longer[1], longer)).toEqual(version(2).activeFrom);
  });

  it('starts at the first version for a lineage with one version', () => {
    expect(measurementStartedAt(version(1), [version(1)])).toEqual(version(1).activeFrom);
  });
});

describe('isPartialObjectiveWindow', () => {
  const windowed = { windowType: 'THIRTY_DAYS', windowValue: null } as const;
  const periodEnd = new Date('2026-09-19T00:00:00.000Z');

  it('is not partial when the whole window was measured', () => {
    expect(
      isPartialObjectiveWindow(windowed, {
        periodStart: new Date('2026-08-20T00:00:00.000Z'),
        periodEnd,
      })
    ).toBe(false);
  });

  it('is partial when the definition started inside the window', () => {
    expect(
      isPartialObjectiveWindow(windowed, {
        periodStart: new Date('2026-09-18T00:00:00.000Z'),
        periodEnd,
      })
    ).toBe(true);
  });

  it('is partial when the service itself is younger than the window', () => {
    const period = { periodStart: new Date('2026-08-20T00:00:00.000Z'), periodEnd };
    expect(isPartialObjectiveWindow(windowed, period, new Date('2026-09-10T00:00:00.000Z'))).toBe(
      true
    );
    expect(isPartialObjectiveWindow(windowed, period, new Date('2026-01-01T00:00:00.000Z'))).toBe(
      false
    );
  });
});

describe('processServiceObjectiveSnapshots partial windows', () => {
  const now = new Date('2026-09-19T08:00:00.000Z');
  const objective = (overrides: Record<string, unknown> = {}) => ({
    id: 'obj-v1',
    lineageId: 'lineage',
    version: 1,
    serviceId: 'svc',
    metricType: 'UPTIME',
    target: 99.9,
    comparator: 'GREATER_THAN_OR_EQUAL',
    windowType: 'THIRTY_DAYS',
    windowValue: null,
    activeFrom: new Date('2026-01-01T00:00:00.000Z'),
    activeTo: null,
    service: { createdAt: new Date('2025-01-01T00:00:00.000Z') },
    ...overrides,
  });
  const evaluation = {
    value: 98,
    sampleCount: null,
    target: 99.9,
    breached: true,
    dataState: 'AVAILABLE',
    definitionVersion: 1,
  };
  const stored = () =>
    (mocks.upsert.mock.calls[0] as [{ create: Record<string, unknown> }])[0].create;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluate.mockResolvedValue(evaluation);
  });

  it('keeps a full window final', async () => {
    mocks.findMany.mockResolvedValueOnce([objective()]);
    await processServiceObjectiveSnapshots(now);
    expect(stored()).toMatchObject({ dataState: 'AVAILABLE', breached: true, value: 98 });
  });

  it('stores a window clipped by a new definition as partial and never as a breach', async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        objective({
          id: 'obj-v2',
          version: 2,
          target: 99.5,
          activeFrom: new Date('2026-09-18T23:59:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        {
          lineageId: 'lineage',
          version: 1,
          target: 99.9,
          comparator: 'GREATER_THAN_OR_EQUAL',
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
    await processServiceObjectiveSnapshots(now);
    expect(stored()).toMatchObject({ dataState: 'PARTIAL', breached: null, value: 98 });
  });

  it('measures a renamed definition over its full window', async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        objective({ id: 'obj-v2', version: 2, activeFrom: new Date('2026-09-18T23:59:00.000Z') }),
      ])
      .mockResolvedValueOnce([
        {
          lineageId: 'lineage',
          version: 1,
          target: 99.9,
          comparator: 'GREATER_THAN_OR_EQUAL',
          windowType: 'THIRTY_DAYS',
          windowValue: null,
          activeFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
    await processServiceObjectiveSnapshots(now);
    expect(stored()).toMatchObject({
      dataState: 'AVAILABLE',
      breached: true,
      periodStart: new Date('2026-08-20T00:00:00.000Z'),
    });
  });

  it('stores an uptime window of a service younger than the window as partial', async () => {
    mocks.findMany.mockResolvedValueOnce([
      objective({ service: { createdAt: new Date('2026-09-10T00:00:00.000Z') } }),
    ]);
    await processServiceObjectiveSnapshots(now);
    expect(stored()).toMatchObject({ dataState: 'PARTIAL', breached: null });
  });

  it('leaves unavailable and no-data results as they are', async () => {
    mocks.evaluate.mockResolvedValue({ ...evaluation, value: null, breached: null, dataState: 'NO_DATA' });
    mocks.findMany.mockResolvedValueOnce([
      objective({ service: { createdAt: new Date('2026-09-10T00:00:00.000Z') } }),
    ]);
    await processServiceObjectiveSnapshots(now);
    expect(stored()).toMatchObject({ dataState: 'NO_DATA', breached: null });
  });
});

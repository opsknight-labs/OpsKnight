import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunbookInputType } from '@prisma/client';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  versions: vi.fn(),
  runbook: vi.fn(),
  rules: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    runbookVersion: { findMany: mocks.versions },
    runbook: { findUnique: mocks.runbook },
    serviceAutomationRule: { findMany: mocks.rules },
  },
}));

import { getVersionImpact } from '@/lib/runbooks/version-impact';

type TestInput = {
  key: string;
  label: string;
  type: RunbookInputType;
  required: boolean;
  defaultValue: string | null;
  options: string[];
};

function input(key: string, overrides: Partial<TestInput> = {}): TestInput {
  return {
    key,
    label: key,
    type: 'STRING',
    required: false,
    defaultValue: null,
    options: [],
    ...overrides,
  };
}

function version(
  id: string,
  number: number,
  stepKeys: string[],
  inputs: TestInput[] = [],
  state: 'DRAFT' | 'PUBLISHED' | 'RETIRED' = 'PUBLISHED',
  definitionExtra: { defaultTimeoutSeconds?: number; defaultMaxRetries?: number } = {}
) {
  return {
    id,
    runbookId: 'rb',
    version: number,
    state,
    checksum: `sum-${id}`,
    inputs,
    definition: {
      ...definitionExtra,
      steps: stepKeys.map(key => ({
        key,
        name: key,
        type: 'MANUAL',
        riskClass: 'READ_ONLY',
        config: {},
      })),
    },
  };
}

function load(base: ReturnType<typeof version>, next: ReturnType<typeof version>) {
  mocks.versions.mockResolvedValue([base, next]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runbook.mockResolvedValue({ publishedVersionId: 'next' });
  mocks.rules.mockResolvedValue([]);
});

describe('getVersionImpact input changes', () => {
  it('reports an input that became required, changed type, default or options', async () => {
    load(
      version('base', 1, ['a'], [input('env'), input('count'), input('region'), input('tier')]),
      version(
        'next',
        2,
        ['a'],
        [
          input('env', { required: true }),
          input('count', { type: 'NUMBER' }),
          input('region', { defaultValue: 'eu' }),
          input('tier', { options: ['gold'] }),
        ]
      )
    );

    const impact = await getVersionImpact('rb', 'base', 'next');

    expect(impact.inputKeys).toEqual({ added: [], removed: [] });
    expect(impact.inputChanges).toEqual([
      expect.objectContaining({
        key: 'env',
        changes: ['required'],
        required: { before: false, after: true },
      }),
      expect.objectContaining({
        key: 'count',
        changes: ['type'],
        type: { before: 'STRING', after: 'NUMBER' },
      }),
      expect.objectContaining({ key: 'region', changes: ['default'] }),
      expect.objectContaining({ key: 'tier', changes: ['options'] }),
    ]);
    // A default value can be sensitive, so only the fact that it changed is returned.
    expect(JSON.stringify(impact.inputChanges)).not.toContain('"eu"');
  });

  it('reports nothing for inputs that did not change', async () => {
    load(version('base', 1, ['a'], [input('env')]), version('next', 2, ['a'], [input('env')]));

    expect((await getVersionImpact('rb', 'base', 'next')).inputChanges).toEqual([]);
  });
});

describe('getVersionImpact step order and run defaults', () => {
  it('flags swapped steps as changed even though each step is identical', async () => {
    load(version('base', 1, ['diagnose', 'restart']), version('next', 2, ['restart', 'diagnose']));

    const impact = await getVersionImpact('rb', 'base', 'next');

    expect(impact.steps.map(step => [step.key, step.change, step.moved])).toEqual([
      ['diagnose', 'CHANGED', true],
      ['restart', 'CHANGED', true],
    ]);
  });

  it('does not call an unmoved step moved because a step was added before it', async () => {
    load(version('base', 1, ['a', 'b']), version('next', 2, ['new', 'a', 'b']));

    const impact = await getVersionImpact('rb', 'base', 'next');

    expect(impact.steps.map(step => [step.key, step.change, step.moved])).toEqual([
      ['a', 'UNCHANGED', false],
      ['b', 'UNCHANGED', false],
      ['new', 'ADDED', false],
    ]);
  });

  it('reports a changed run timeout or retry default', async () => {
    load(
      version('base', 1, ['a'], [], 'PUBLISHED', { defaultTimeoutSeconds: 60 }),
      version('next', 2, ['a'], [], 'PUBLISHED', {
        defaultTimeoutSeconds: 600,
        defaultMaxRetries: 2,
      })
    );

    const impact = await getVersionImpact('rb', 'base', 'next');

    expect(impact.defaults).toEqual({
      before: { timeoutSeconds: 60, maxRetries: null },
      after: { timeoutSeconds: 600, maxRetries: 2 },
      changed: true,
    });
  });

  it('reports no default change when both versions use the same defaults', async () => {
    load(version('base', 1, ['a']), version('next', 2, ['a']));

    expect((await getVersionImpact('rb', 'base', 'next')).defaults.changed).toBe(false);
  });
});

describe('getVersionImpact rule impact', () => {
  const rule = (id: string, versionStrategy: 'PINNED' | 'LATEST_PUBLISHED') => ({
    id,
    name: id,
    serviceId: 'svc',
    enabled: true,
    mode: 'MANUAL',
    versionStrategy,
    runbookVersionId: versionStrategy === 'PINNED' ? 'base' : null,
    service: { id: 'svc', name: 'Checkout' },
  });

  it('does not say latest-publication rules track a version that is not the live one', async () => {
    load(version('base', 1, ['a']), version('next', 2, ['a']));
    mocks.runbook.mockResolvedValue({ publishedVersionId: 'v5' });
    mocks.rules.mockResolvedValue([rule('latest', 'LATEST_PUBLISHED'), rule('pinned', 'PINNED')]);

    const impact = await getVersionImpact('rb', 'base', 'next');

    expect(impact.rules.map(r => [r.id, r.impact])).toEqual([
      ['latest', 'TRACKS_LIVE_VERSION'],
      ['pinned', 'PINNED_UNCHANGED'],
    ]);
  });

  it('says latest-publication rules track the compared version when it is live or a draft', async () => {
    load(version('base', 1, ['a']), version('next', 2, ['a']));
    mocks.rules.mockResolvedValue([rule('latest', 'LATEST_PUBLISHED')]);

    expect((await getVersionImpact('rb', 'base', 'next')).rules[0].impact).toBe(
      'TRACKS_NEW_PUBLICATION'
    );

    load(version('base', 1, ['a']), version('next', 2, ['a'], [], 'DRAFT'));
    mocks.runbook.mockResolvedValue({ publishedVersionId: 'v5' });

    expect((await getVersionImpact('rb', 'base', 'next')).rules[0].impact).toBe(
      'TRACKS_NEW_PUBLICATION'
    );
  });

  it('leaves detached rules out and lists latest-publication rules first when truncated', async () => {
    load(version('base', 1, ['a']), version('next', 2, ['a']));

    await getVersionImpact('rb', 'base', 'next');

    expect(mocks.rules).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runbookId: 'rb', detachedAt: null },
        orderBy: [{ versionStrategy: 'desc' }, { enabled: 'desc' }, { id: 'asc' }],
        take: 501,
      })
    );
  });
});

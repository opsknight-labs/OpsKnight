import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { getBindingReadiness } from '@/lib/runbooks/binding-readiness';

type Binding = Parameters<typeof getBindingReadiness>[0];

const version = (state: 'PUBLISHED' | 'RETIRED') => ({
  id: 'ver_pinned',
  version: 3,
  state,
  definition: { description: '', steps: [] },
  inputs: [],
});

function pinnedRule(state: 'PUBLISHED' | 'RETIRED'): Binding {
  return {
    enabled: true,
    mode: 'AUTOMATIC',
    versionStrategy: 'PINNED',
    defaultAgentId: null,
    defaultAgentPoolId: null,
    agentSelector: {},
    inputValues: {},
    runbook: { archivedAt: null, publishedVersion: null },
    runbookVersion: version(state),
    triggers: [{ enabled: true, event: 'INCIDENT_CREATED', conditions: [] }],
  } as unknown as Binding;
}

describe('getBindingReadiness for a rule pinned to a retired version', () => {
  it('blocks it and says which version retired and what to do', async () => {
    const readiness = await getBindingReadiness(
      pinnedRule('RETIRED'),
      new Date(),
      {} as Prisma.TransactionClient
    );
    expect(readiness.state).toBe('BLOCKED');
    expect(readiness.checks).toContainEqual({
      code: 'VERSION_RETIRED',
      state: 'blocked',
      message:
        'Version 3 is retired and cannot run. Publish a current version and pin this rule to it.',
    });
  });

  it('does not raise the retired check for a published version', async () => {
    const readiness = await getBindingReadiness(
      pinnedRule('PUBLISHED'),
      new Date(),
      {} as Prisma.TransactionClient
    ).catch(() => null);
    expect(readiness?.checks.some(check => check.code === 'VERSION_RETIRED') ?? false).toBe(false);
  });
});

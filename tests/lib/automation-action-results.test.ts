import { beforeEach, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  saveDraft: vi.fn(),
  publishVersion: vi.fn(),
  changeMode: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/automation/access', () => ({ assertAutomationAccess: mocks.access }));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/automation/versioning', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/automation/versioning')>()),
  saveDraft: mocks.saveDraft,
  publishVersion: mocks.publishVersion,
  changeMode: mocks.changeMode,
}));
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import { AutomationConflict } from '@/lib/automation/versioning';
import { AuthorizationError } from '@/lib/authorization';
import { emptySnapshot } from '@/lib/automation/contract';

const save = {
  action: 'save',
  serviceId: 'service-a',
  snapshot: emptySnapshot,
  expectedRevision: 2,
};
const publish = {
  action: 'publish',
  serviceId: 'service-a',
  expectedRevision: 2,
  expectedActiveVersionId: 'version-1',
};
const mode = {
  action: 'mode',
  serviceId: 'service-a',
  mode: 'LIVE',
  expectedActiveVersionId: 'version-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
});

it('returns CONFLICT for stale draft revisions and active versions', async () => {
  mocks.saveDraft.mockRejectedValue(new AutomationConflict());
  mocks.publishVersion.mockRejectedValue(new AutomationConflict());
  for (const input of [save, publish])
    expect(await automationAction(input)).toEqual({
      ok: false,
      code: 'CONFLICT',
      conflict: true,
      error: 'Another version was saved. Reload or review your changes before saving.',
    });
});

it('returns domain guard messages for blocked publish and mode changes', async () => {
  mocks.publishVersion.mockRejectedValue(
    new Error('Escalation policy is archived. Restore it before creating new references.')
  );
  expect(await automationAction(publish)).toEqual({
    ok: false,
    code: 'REJECTED',
    conflict: false,
    error: 'Escalation policy is archived. Restore it before creating new references.',
  });
  mocks.changeMode.mockRejectedValue(
    new Error('Acknowledge activation without Shadow traffic for this published version.')
  );
  expect(await automationAction(mode)).toMatchObject({
    code: 'REJECTED',
    error: 'Acknowledge activation without Shadow traffic for this published version.',
  });
  mocks.changeMode.mockRejectedValue(new Error('VERSION_INVALID'));
  expect(await automationAction(mode)).toMatchObject({
    code: 'REJECTED',
    error: expect.stringContaining('failed integrity validation'),
  });
});

it('returns FORBIDDEN for access denial', async () => {
  mocks.access.mockRejectedValue(
    new AuthorizationError('Automation access denied', 'automation.publish' as never)
  );
  expect(await automationAction(mode)).toEqual({
    ok: false,
    code: 'FORBIDDEN',
    conflict: false,
    error: 'Automation access denied',
  });
  expect(mocks.changeMode).not.toHaveBeenCalled();
});

it('returns a concise VALIDATION message instead of a serialized schema error', async () => {
  const response = await automationAction({ ...mode, mode: 'TURBO' });
  expect(response).toMatchObject({ ok: false, code: 'VALIDATION', conflict: false });
  if (!response.ok) {
    expect(response.error).toMatch(/^mode: /);
    expect(response.error).not.toContain('[');
  }
});

it('does not leak internal errors', async () => {
  mocks.saveDraft.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed on "AutomationDraft"', {
      code: 'P2002',
      clientVersion: 'test',
    })
  );
  expect(await automationAction(save)).toEqual({
    ok: false,
    code: 'UNEXPECTED',
    conflict: false,
    error: 'Automation request failed. Try again.',
  });
  mocks.changeMode.mockRejectedValue(new TypeError('Cannot read properties of undefined'));
  expect(await automationAction(mode)).toMatchObject({ code: 'UNEXPECTED' });
  expect(mocks.logError).toHaveBeenCalledTimes(2);
});

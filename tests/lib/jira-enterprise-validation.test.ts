import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  encrypt: vi.fn(),
  findJiraConfig: vi.fn(),
  transaction: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  acquireJiraWorkspaceLifecycleFence: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ assertAdmin: mocks.assertAdmin }));
vi.mock('@/lib/encryption', () => ({ encrypt: mocks.encrypt }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/jira-concurrency', () => ({
  acquireJiraWorkspaceLifecycleFence: mocks.acquireJiraWorkspaceLifecycleFence,
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    jiraConfig: { findUnique: mocks.findJiraConfig },
    $transaction: mocks.transaction,
  },
}));

import { saveJiraConfig } from '@/app/(app)/settings/integrations/jira/actions';
import { normalizeJiraBaseUrl } from '@/lib/jira-validation';

const REVISION = '2026-09-11T06:30:00.000Z';

function configForm(baseUrl: string, apiToken = '********') {
  const form = new FormData();
  form.set('baseUrl', baseUrl);
  form.set('userEmail', 'ops@acme.example');
  form.set('apiToken', apiToken);
  form.set('webhookSecret', '********');
  form.set('enabled', 'true');
  return form;
}

describe('Jira enterprise security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdmin.mockResolvedValue({ id: 'admin-1' });
    mocks.findJiraConfig.mockResolvedValue({
      id: 'default',
      baseUrl: 'https://acme.atlassian.net',
      userEmail: 'ops@acme.example',
      apiTokenEncrypted: 'encrypted-existing-token',
      webhookSecretEncrypted: 'encrypted-webhook-secret',
      enabled: true,
      updatedAt: new Date(REVISION),
    });
  });

  it('never carries a masked stored API token across Jira origins', async () => {
    const result = await saveJiraConfig(
      { success: true, error: null, updatedAt: REVISION },
      configForm('https://attacker.example')
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain('Re-enter the Jira API token');
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('allows an origin change only when a fresh API token is supplied', async () => {
    mocks.encrypt.mockResolvedValueOnce('encrypted-fresh-token');
    mocks.transaction.mockImplementation(async callback => {
      const tx = {
        jiraConfig: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ updatedAt: new Date(REVISION) }),
        },
      };
      mocks.acquireJiraWorkspaceLifecycleFence.mockResolvedValue(undefined);
      return callback(tx);
    });

    const result = await saveJiraConfig(
      { success: true, error: null, updatedAt: REVISION },
      configForm('https://new-acme.atlassian.net', 'fresh-token')
    );

    expect(result.success).toBe(true);
    expect(mocks.encrypt).toHaveBeenCalledWith('fresh-token');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects confusing or local outbound Jira URLs', () => {
    expect(() => normalizeJiraBaseUrl('https://user:pass@example.com')).toThrow(
      'must not contain embedded credentials'
    );
    expect(() => normalizeJiraBaseUrl('https://example.com/?token=secret')).toThrow(
      'must not contain query parameters or fragments'
    );
    expect(() => normalizeJiraBaseUrl('https://127.0.0.1')).toThrow('forbidden local');
    expect(() => normalizeJiraBaseUrl('https://169.254.169.254')).toThrow('forbidden local');
    expect(() => normalizeJiraBaseUrl('https://metadata.google.internal')).toThrow(
      'forbidden local'
    );
  });
});

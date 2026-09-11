import { describe, expect, it } from 'vitest';
import { classifyJiraError, deriveJiraCapability } from '@/lib/jira-capabilities';

describe('classifyJiraError', () => {
  it.each([
    ['Jira is not configured in workspace settings.', 'JIRA_NOT_CONFIGURED', false],
    ['Jira integration_disabled', 'JIRA_DISABLED', false],
    ['Jira request failed (401): authentication failed', 'JIRA_AUTH_FAILED', false],
    ['Jira request failed (403): forbidden', 'JIRA_FORBIDDEN', false],
    ["The target project doesn't exist.", 'JIRA_PROJECT_NOT_FOUND', false],
    ['Issue type "Bugz" is invalid.', 'JIRA_ISSUE_TYPE_INVALID', false],
    ['Component "BackendX" does not exist', 'JIRA_COMPONENT_INVALID', false],
    ['Issue OPS-404 was not found', 'JIRA_ISSUE_NOT_FOUND', false],
    ['Issue is already linked to another entity', 'JIRA_ISSUE_ALREADY_LINKED', false],
    ['Jira request failed (429): rate limit exceeded', 'JIRA_RATE_LIMITED', true],
    ['fetch failed: timeout', 'JIRA_TIMEOUT', true],
    ['Jira request failed (503): unavailable', 'JIRA_UNAVAILABLE', true],
  ])('classifies %s as %s', (message, expectedCode, retryable) => {
    const result = classifyJiraError(new Error(message));
    expect(result.code).toBe(expectedCode);
    expect(result.retryable).toBe(retryable);
    expect(result.userMessage.length).toBeGreaterThan(0);
  });

  it('falls back to UNKNOWN without losing a bounded user-facing message', () => {
    const result = classifyJiraError(new Error('some random provider failure'));
    expect(result.code).toBe('JIRA_UNKNOWN');
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain('Jira operation failed');
  });
});

describe('deriveJiraCapability production contract', () => {
  const derive = (overrides: Partial<Parameters<typeof deriveJiraCapability>[0]> = {}) =>
    deriveJiraCapability({
      workspaceState: 'ENABLED',
      canManage: true,
      serviceMapped: true,
      syncEnabled: true,
      rawEnabled: true,
      ...overrides,
    });

  it('never configured: exposes no operational Jira actions', () => {
    const cap = derive({
      workspaceState: 'NOT_CONFIGURED',
      serviceMapped: false,
      syncEnabled: true,
      rawEnabled: false,
    });

    expect(cap).toMatchObject({
      showOperationalJira: false,
      canCreate: false,
      canLink: false,
      canSync: false,
      canUnlink: false,
      reason: 'NOT_CONFIGURED',
    });
  });

  it('configured but incomplete: exposes no operational Jira actions', () => {
    const cap = derive({
      workspaceState: 'CONFIGURED',
      serviceMapped: false,
      syncEnabled: true,
    });

    expect(cap.showOperationalJira).toBe(false);
    expect(cap.canCreate).toBe(false);
    expect(cap.canLink).toBe(false);
    expect(cap.canSync).toBe(false);
    expect(cap.canUnlink).toBe(false);
    expect(cap.reason).toBe('CONFIGURED');
  });

  it('disabled: keeps every operational action off even when a service is mapped', () => {
    const cap = derive({ workspaceState: 'DISABLED' });

    expect(cap.showOperationalJira).toBe(false);
    expect(cap.canCreate).toBe(false);
    expect(cap.canLink).toBe(false);
    expect(cap.canSync).toBe(false);
    expect(cap.canUnlink).toBe(false);
    expect(cap.reason).toBe('DISABLED');
  });

  it('enabled but unmapped: allows link/sync/unlink but not create', () => {
    const cap = derive({ serviceMapped: false, syncEnabled: true });

    expect(cap.showOperationalJira).toBe(true);
    expect(cap.canCreate).toBe(false);
    expect(cap.canLink).toBe(true);
    expect(cap.canSync).toBe(true);
    expect(cap.canUnlink).toBe(true);
    expect(cap.reason).toBe('NOT_MAPPED');
  });

  it('enabled, mapped, sync enabled: exposes the full action set', () => {
    const cap = derive();

    expect(cap.showOperationalJira).toBe(true);
    expect(cap.canCreate).toBe(true);
    expect(cap.canLink).toBe(true);
    expect(cap.canSync).toBe(true);
    expect(cap.canUnlink).toBe(true);
    expect(cap.reason).toBe('OK');
  });

  it('mapped service with sync disabled: hides sync while preserving create/link/unlink', () => {
    const cap = derive({ syncEnabled: false });

    expect(cap.canCreate).toBe(true);
    expect(cap.canLink).toBe(true);
    expect(cap.canSync).toBe(false);
    expect(cap.canUnlink).toBe(true);
    expect(cap.reason).toBe('SYNC_DISABLED');
  });

  it('insufficient permission: exposes no operational actions', () => {
    const cap = derive({ canManage: false });

    expect(cap.showOperationalJira).toBe(false);
    expect(cap.canCreate).toBe(false);
    expect(cap.canLink).toBe(false);
    expect(cap.canSync).toBe(false);
    expect(cap.canUnlink).toBe(false);
  });
});

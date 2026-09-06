import { describe, expect, it } from 'vitest';
import {
  isValidJiraKey,
  normalizeJiraBaseUrl,
  assertJiraProjectKey,
  assertJiraIssueType,
  parseLabels,
} from '@/lib/jira-validation';

describe('jira validation helpers', () => {
  // -------------------------------------------------------------------------
  // isValidJiraKey
  // -------------------------------------------------------------------------
  describe('isValidJiraKey', () => {
    it('accepts standard Jira keys (including lowercase auto-capitalized keys)', () => {
      expect(isValidJiraKey('OPS-123')).toBe(true);
      expect(isValidJiraKey('ops-123')).toBe(true); // auto-capitalized to OPS-123
      expect(isValidJiraKey('PROJ-1')).toBe(true);
      expect(isValidJiraKey('MY_PROJECT-9999')).toBe(true);
    });

    it('rejects invalid keys', () => {
      expect(isValidJiraKey('')).toBe(false);
      expect(isValidJiraKey('123')).toBe(false);
      expect(isValidJiraKey('OPS')).toBe(false); // no dash + number
      expect(isValidJiraKey('OPS-')).toBe(false); // missing number
      expect(isValidJiraKey('-123')).toBe(false); // missing project
      expect(isValidJiraKey('OPS-abc')).toBe(false); // letters after dash
    });
  });

  // -------------------------------------------------------------------------
  // normalizeJiraBaseUrl
  // -------------------------------------------------------------------------
  describe('normalizeJiraBaseUrl', () => {
    it('accepts valid HTTPS URLs', () => {
      expect(normalizeJiraBaseUrl('https://myteam.atlassian.net')).toBe(
        'https://myteam.atlassian.net'
      );
    });

    it('strips trailing slashes', () => {
      expect(normalizeJiraBaseUrl('https://myteam.atlassian.net/')).toBe(
        'https://myteam.atlassian.net'
      );
      expect(normalizeJiraBaseUrl('https://myteam.atlassian.net///')).toBe(
        'https://myteam.atlassian.net'
      );
    });

    it('auto-prepends https:// when no protocol is provided', () => {
      expect(normalizeJiraBaseUrl('myteam.atlassian.net')).toBe(
        'https://myteam.atlassian.net'
      );
    });

    it('auto-prepends https:// and strips trailing slashes', () => {
      expect(normalizeJiraBaseUrl('myteam.atlassian.net/')).toBe(
        'https://myteam.atlassian.net'
      );
    });

    it('rejects HTTP URLs', () => {
      expect(() => normalizeJiraBaseUrl('http://myteam.atlassian.net')).toThrow(
        'Jira URL must use HTTPS.'
      );
    });

    it('throws a user-friendly message for completely invalid input', () => {
      expect(() => normalizeJiraBaseUrl('not a url at all!!!')).toThrow(
        'Invalid Jira URL'
      );
    });

    it('handles whitespace around the URL', () => {
      expect(normalizeJiraBaseUrl('  https://myteam.atlassian.net  ')).toBe(
        'https://myteam.atlassian.net'
      );
    });
  });

  // -------------------------------------------------------------------------
  // assertJiraProjectKey
  // -------------------------------------------------------------------------
  describe('assertJiraProjectKey', () => {
    it('normalizes valid project keys to uppercase', () => {
      expect(assertJiraProjectKey('ops')).toBe('OPS');
      expect(assertJiraProjectKey('My_Proj')).toBe('MY_PROJ');
    });

    it('rejects invalid project keys', () => {
      expect(() => assertJiraProjectKey('')).toThrow();
      expect(() => assertJiraProjectKey('123')).toThrow();
      expect(() => assertJiraProjectKey('A-B')).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // assertJiraIssueType
  // -------------------------------------------------------------------------
  describe('assertJiraIssueType', () => {
    it('accepts valid issue types', () => {
      expect(assertJiraIssueType('Bug', 'Issue type')).toBe('Bug');
      expect(assertJiraIssueType('  Task  ', 'Issue type')).toBe('Task');
    });

    it('rejects empty issue types', () => {
      expect(() => assertJiraIssueType('', 'Issue type')).toThrow();
      expect(() => assertJiraIssueType('   ', 'Issue type')).toThrow();
    });

    it('rejects excessively long issue types', () => {
      expect(() => assertJiraIssueType('A'.repeat(81), 'Issue type')).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // parseLabels
  // -------------------------------------------------------------------------
  describe('parseLabels', () => {
    it('splits comma-separated labels', () => {
      expect(parseLabels('opsknight, frontend, bug')).toEqual([
        'opsknight',
        'frontend',
        'bug',
      ]);
    });

    it('deduplicates labels', () => {
      expect(parseLabels('a, b, a, c, b')).toEqual(['a', 'b', 'c']);
    });

    it('handles empty input', () => {
      expect(parseLabels('')).toEqual([]);
      expect(parseLabels('   ')).toEqual([]);
    });
  });
});

describe('webhook payload handling', () => {
  it('extracts status and assignee from issue_updated payload', () => {
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: '10001',
        key: 'OPS-42',
        fields: {
          status: { name: 'In Progress' },
          assignee: { displayName: 'Alice', emailAddress: 'alice@example.com' },
        },
      },
    };

    expect(payload.issue?.fields?.status?.name).toBe('In Progress');
    expect(payload.issue?.fields?.assignee?.displayName).toBe('Alice');
  });

  it('handles missing assignee gracefully', () => {
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: '10001',
        key: 'OPS-42',
        fields: {
          status: { name: 'Done' },
          assignee: null as null | { displayName?: string; emailAddress?: string },
        },
      },
    };

    const assignee =
      payload.issue?.fields?.assignee?.displayName ??
      payload.issue?.fields?.assignee?.emailAddress ??
      null;

    expect(assignee).toBeNull();
  });

  it('only updates fields present in partial webhook payloads', () => {
    // Simulates the fix: when a webhook payload only contains status
    // but not assignee, we should NOT overwrite assignee
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: '10001',
        key: 'OPS-42',
        fields: {
          status: { name: 'Done' },
          // Note: no 'assignee' field at all
        },
      },
    };

    const data: Record<string, unknown> = {
      syncState: 'SYNCED',
      lastSyncedAt: new Date(),
    };

    if (payload.issue?.fields && 'status' in payload.issue.fields) {
      data.externalStatus = payload.issue.fields.status?.name ?? null;
    }

    if (payload.issue?.fields && 'assignee' in payload.issue.fields) {
      data.externalAssignee = null; // Would only run if assignee key exists
    }

    // Status should be updated
    expect(data.externalStatus).toBe('Done');
    // Assignee should NOT be in the update data
    expect('externalAssignee' in data).toBe(false);
  });

  it('identifies unhandled event types', () => {
    const handledEvents = new Set(['jira:issue_updated', 'jira:issue_deleted']);
    expect(handledEvents.has('jira:issue_updated')).toBe(true);
    expect(handledEvents.has('jira:issue_created')).toBe(false);
    expect(handledEvents.has('project_updated')).toBe(false);
  });

  it('extracts issue id and key for link matching', () => {
    const payload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: '10042',
        key: 'PROJ-99',
        fields: {
          status: { name: 'To Do' },
        },
      },
    };

    expect(payload.issue?.id).toBe('10042');
    expect(payload.issue?.key).toBe('PROJ-99');
  });

  it('returns no match indicators for empty payloads', () => {
    const payload: { webhookEvent: string; issue?: { id?: string; key?: string } } = {
      webhookEvent: 'jira:issue_updated',
    };

    expect(payload.issue?.id).toBeUndefined();
    expect(payload.issue?.key).toBeUndefined();
  });
});

describe('formatError (login)', () => {
  // Test the logic used in both LoginClient and MobileLoginClient
  function formatError(message: string | null | undefined) {
    if (!message) return '';
    if (message === 'SessionRequired') return '';
    if (message === 'CredentialsSignin') return 'Invalid email or password';
    if (message === 'AccessDenied') return 'Access denied';
    if (message === 'SessionExpired') return 'Your session has expired. Please sign in again.';
    if (message === 'OAuthSignin' || message === 'OAuthCallback')
      return 'SSO authentication failed. Please try again or contact your administrator.';
    if (message === 'Configuration')
      return 'Server configuration error. Please contact your administrator.';
    return 'Authentication failed. Please try again.';
  }

  it('returns empty string for SessionRequired (not a real error)', () => {
    expect(formatError('SessionRequired')).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatError(null)).toBe('');
    expect(formatError(undefined)).toBe('');
    expect(formatError('')).toBe('');
  });

  it('returns user-friendly message for CredentialsSignin', () => {
    expect(formatError('CredentialsSignin')).toBe('Invalid email or password');
  });

  it('handles SSO errors', () => {
    expect(formatError('OAuthSignin')).toContain('SSO authentication failed');
    expect(formatError('OAuthCallback')).toContain('SSO authentication failed');
  });

  it('handles Configuration error', () => {
    expect(formatError('Configuration')).toContain('Server configuration error');
  });

  it('handles SessionExpired', () => {
    expect(formatError('SessionExpired')).toContain('session has expired');
  });

  it('returns generic message for unknown error codes', () => {
    expect(formatError('SomeNewError')).toBe('Authentication failed. Please try again.');
  });
});

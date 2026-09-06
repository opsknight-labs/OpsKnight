import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jiraConfigFindUnique: vi.fn(),
  decrypt: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    jiraConfig: {
      findUnique: mocks.jiraConfigFindUnique,
    },
  },
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: mocks.decrypt,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch
global.fetch = mocks.fetch as unknown as typeof fetch;

import { createJiraIssue } from '@/lib/jira';

describe('createJiraIssue initial status retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.jiraConfigFindUnique.mockResolvedValue({
      id: 'default',
      baseUrl: 'https://test-team.atlassian.net',
      userEmail: 'dev@example.com',
      apiTokenEncrypted: 'enc-token',
      enabled: true,
    });
    mocks.decrypt.mockResolvedValue('decrypted-api-token');
  });

  it('fetches real Jira status and statusCategory rather than returning placeholder "Created"', async () => {
    // 1st fetch: POST /rest/api/3/issue (create issue)
    // 2nd fetch: GET /rest/api/3/issue/PROJ-101?fields=status,assignee
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: '10001',
          key: 'PROJ-101',
          self: 'https://test-team.atlassian.net/rest/api/3/issue/10001',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: '10001',
          key: 'PROJ-101',
          fields: {
            status: {
              name: 'To Do',
              statusCategory: {
                id: 2,
                key: 'new',
                name: 'To Do',
              },
            },
            assignee: {
              displayName: 'Alice Engineer',
              emailAddress: 'alice@example.com',
            },
          },
        }),
      } as Response);

    const result = await createJiraIssue({
      projectKey: 'PROJ',
      issueType: 'Bug',
      summary: 'Production Outage',
      description: 'System down',
    });

    expect(result).toEqual({
      id: '10001',
      key: 'PROJ-101',
      url: 'https://test-team.atlassian.net/browse/PROJ-101',
      status: 'To Do',
      assignee: 'Alice Engineer',
      statusCategoryKey: 'new',
      statusCategoryName: 'To Do',
    });

    expect(result.status).not.toBe('Created');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to "Open" status if the secondary details fetch fails', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: '10002',
          key: 'PROJ-102',
          self: 'https://test-team.atlassian.net/rest/api/3/issue/10002',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

    const result = await createJiraIssue({
      projectKey: 'PROJ',
      issueType: 'Task',
      summary: 'Task test',
    });

    expect(result).toEqual({
      id: '10002',
      key: 'PROJ-102',
      url: 'https://test-team.atlassian.net/browse/PROJ-102',
      status: 'Open',
    });
    expect(result.status).not.toBe('Created');
  });

  it('throws AppError when Jira integration is not enabled', async () => {
    mocks.jiraConfigFindUnique.mockResolvedValueOnce({
      enabled: false,
    });

    await expect(
      createJiraIssue({
        projectKey: 'PROJ',
        issueType: 'Bug',
        summary: 'Summary',
      })
    ).rejects.toThrow();
  });
});

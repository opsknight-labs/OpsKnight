import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { integrationProviderError } from '@/lib/provider-errors';
import { normalizeJiraBaseUrl } from '@/lib/jira-validation';

export type JiraIssueSummary = {
  id: string;
  key: string;
  url: string;
  status?: string;
  assignee?: string;
};

type JiraConfigForRequest = {
  baseUrl: string;
  userEmail: string;
  apiToken: string;
};

type JiraIssueResponse = {
  id: string;
  key: string;
  self?: string;
  fields?: {
    status?: { name?: string };
    assignee?: { displayName?: string; emailAddress?: string };
  };
};

type JiraCreateIssueResponse = {
  id: string;
  key: string;
  self: string;
};

type CreateJiraIssueInput = {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string | null;
  labels?: string[];
  component?: string | null;
};

function authHeader(config: JiraConfigForRequest) {
  const token = Buffer.from(`${config.userEmail}:${config.apiToken}`).toString('base64');
  return `Basic ${token}`;
}

function jiraIssueUrl(baseUrl: string, key: string) {
  return `${baseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;
}

function toADF(text: string) {
  // Jira rejects paragraphs with an empty content array as invalid ADF.
  // Always provide at least a single text node.
  const safeText = text || '\u00a0';
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: safeText }],
      },
    ],
  };
}

async function jiraRequest<T>(
  config: JiraConfigForRequest,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(config),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw integrationProviderError({
      provider: 'jira',
      operation: `${init.method || 'GET'} ${path}`,
      cause: error,
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw integrationProviderError({
      provider: 'jira',
      operation: `${init.method || 'GET'} ${path}`,
      status: response.status,
      cause: body
        ? new Error(`Jira request failed (${response.status}) with a provider response body.`)
        : new Error(`Jira request failed (${response.status}).`),
    });
  }

  return (await response.json()) as T;
}

export async function getDecryptedJiraConfig(): Promise<JiraConfigForRequest | null> {
  const config = await prisma.jiraConfig.findUnique({
    where: { id: 'default' },
    select: {
      baseUrl: true,
      userEmail: true,
      apiTokenEncrypted: true,
      enabled: true,
    },
  });

  if (!config?.enabled) return null;

  return {
    baseUrl: normalizeJiraBaseUrl(config.baseUrl),
    userEmail: config.userEmail,
    apiToken: await decrypt(config.apiTokenEncrypted),
  };
}

function jiraNotConfigured(): AppError {
  return new AppError({
    code: 'INTEGRATION_DISABLED',
    userMessage: 'Jira is not configured or is disabled.',
    action: 'Configure and enable Jira before using Jira workflows.',
    details: { provider: 'jira' },
  });
}

export async function testJiraConnection(config: JiraConfigForRequest): Promise<{
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
}> {
  return jiraRequest(config, '/rest/api/3/myself');
}

export async function createJiraIssue(input: CreateJiraIssueInput): Promise<JiraIssueSummary> {
  const config = await getDecryptedJiraConfig();
  if (!config) {
    throw jiraNotConfigured();
  }

  const payload = {
    fields: {
      project: { key: input.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary.slice(0, 255),
      description: toADF(input.description ?? ''),
      labels: input.labels ?? [],
      ...(input.component ? { components: [{ name: input.component }] } : {}),
    },
  };

  const created = await jiraRequest<JiraCreateIssueResponse>(config, '/rest/api/3/issue', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    id: created.id,
    key: created.key,
    url: jiraIssueUrl(config.baseUrl, created.key),
    status: 'Created',
  };
}

export async function getJiraIssue(issueKeyOrId: string): Promise<JiraIssueSummary> {
  const config = await getDecryptedJiraConfig();
  if (!config) {
    throw jiraNotConfigured();
  }

  const issue = await jiraRequest<JiraIssueResponse>(
    config,
    `/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}?fields=status,assignee`
  );

  return {
    id: issue.id,
    key: issue.key,
    url: jiraIssueUrl(config.baseUrl, issue.key),
    status: issue.fields?.status?.name,
    assignee: issue.fields?.assignee?.displayName ?? issue.fields?.assignee?.emailAddress,
  };
}

export async function addJiraComment(
  issueKeyOrId: string,
  commentText: string
): Promise<void> {
  const config = await getDecryptedJiraConfig();
  if (!config) return;

  const payload = {
    body: toADF(commentText),
  };

  await jiraRequest(config, `/rest/api/3/issue/${encodeURIComponent(issueKeyOrId)}/comment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

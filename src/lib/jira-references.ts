import { sanitizeUrl } from '@/lib/email-components';

export type JiraIssueReference = {
  linkId: string;
  provider: string;
  key: string;
  /** Safe HTTP(S) destination only. Missing/unsafe URLs render as non-clickable metadata. */
  url?: string;
  status?: string;
  assignee?: string;
  syncState?: string;
};

export type JiraIssueReferenceRecord = {
  id: string;
  provider?: string | null;
  externalKey: string;
  externalUrl?: string | null;
  externalStatus?: string | null;
  externalAssignee?: string | null;
  syncState?: string | null;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Validate untrusted/provider-sourced URLs at the shared Jira boundary.
 *
 * `sanitizeUrl` is the repository-wide scheme sanitizer. Jira references are
 * stricter than generic notification links, so mailto:/tel: are additionally
 * rejected and only canonical HTTP(S) URLs are returned to React href props.
 */
export function sanitizeJiraHttpUrl(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw || sanitizeUrl(raw) === '#') return undefined;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function normalizeJiraIssueReference(value: unknown): JiraIssueReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;

  const linkId = nonEmptyString(entry.linkId) ?? nonEmptyString(entry.id);
  const provider = nonEmptyString(entry.provider);
  const key = nonEmptyString(entry.key) ?? nonEmptyString(entry.externalKey);

  if (!linkId || !provider || !key) return undefined;

  return {
    linkId,
    provider,
    key,
    url: sanitizeJiraHttpUrl(entry.url ?? entry.externalUrl),
    status: nonEmptyString(entry.status) ?? nonEmptyString(entry.externalStatus),
    assignee: nonEmptyString(entry.assignee) ?? nonEmptyString(entry.externalAssignee),
    syncState: nonEmptyString(entry.syncState),
  };
}

export function serializeJiraIssueReference(
  record: JiraIssueReferenceRecord
): JiraIssueReference {
  return {
    linkId: record.id,
    provider: record.provider || 'JIRA',
    key: record.externalKey,
    url: sanitizeJiraHttpUrl(record.externalUrl),
    status: record.externalStatus ?? undefined,
    assignee: record.externalAssignee ?? undefined,
    syncState: record.syncState ?? undefined,
  };
}

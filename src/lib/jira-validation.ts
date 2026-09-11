import { isIP } from 'node:net';

function isForbiddenJiraHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal' ||
    host === 'metadata.azure.internal'
  ) {
    return true;
  }

  const family = isIP(host);
  if (family === 4) {
    const octets = host.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (family === 6) {
    return host === '::1' || host.startsWith('fe80:') || host === '::';
  }

  return false;
}

export function normalizeJiraBaseUrl(value: string): string {
  let trimmed = value.trim().replace(/\/+$/, '');

  // Auto-prepend https:// when no protocol is provided (e.g. "myteam.atlassian.net")
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      'Invalid Jira URL. Please enter a valid URL such as https://myteam.atlassian.net'
    );
  }

  if (url.protocol !== 'https:') {
    throw new Error('Jira URL must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Jira URL must not contain embedded credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('Jira URL must not contain query parameters or fragments.');
  }
  if (isForbiddenJiraHost(url.hostname)) {
    throw new Error('Jira URL points to a forbidden local or metadata address.');
  }

  return url.toString().replace(/\/+$/, '');
}

export function extractJiraKey(value: string): string {
  const trimmed = value.trim();
  // Match key patterns like SCRUM-123 even inside full URLs
  const match = trimmed.match(/([A-Za-z][A-Za-z0-9_]+-\d+)/);
  if (match) {
    return match[1].toUpperCase();
  }
  return trimmed.toUpperCase();
}

export function isValidJiraKey(value: string): boolean {
  const key = extractJiraKey(value);
  return /^[A-Z][A-Z0-9_]+-\d+$/.test(key);
}

export function parseLabels(value: string): string[] {
  return value
    .split(/[\n,\s]+/)
    .map(label => label.trim())
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

export function assertJiraProjectKey(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+$/.test(normalized)) {
    throw new Error('Jira project key must contain uppercase letters, numbers, or underscores.');
  }
  return normalized;
}

export function assertJiraIssueType(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) {
    throw new Error(`${fieldName} is required and must be 80 characters or fewer.`);
  }
  return normalized;
}

const DONE_STATUS_NAMES = new Set([
  'done',
  'closed',
  'resolved',
  'complete',
  'completed',
  'fixed',
  'deployed',
  'verified',
  'shipped',
  'cancelled',
  'canceled',
  'fin',
  'finished',
]);

/**
 * Determine whether a Jira status or status category represents completion.
 * Checks statusCategoryKey (e.g. 'done'), statusCategoryName, and standard Done status names.
 */
export function isJiraStatusDone(
  statusName?: string | null,
  statusCategoryKey?: string | null,
  statusCategoryName?: string | null
): boolean {
  if (statusCategoryKey && statusCategoryKey.trim().toLowerCase() === 'done') {
    return true;
  }
  if (statusCategoryName && statusCategoryName.trim().toLowerCase() === 'done') {
    return true;
  }
  if (!statusName) return false;
  const normalized = statusName.trim().toLowerCase();
  if (DONE_STATUS_NAMES.has(normalized)) return true;
  return /^(done|closed|resolved|completed?|finished|fixed)$/i.test(normalized);
}

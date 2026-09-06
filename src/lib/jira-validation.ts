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

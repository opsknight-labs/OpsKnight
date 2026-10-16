export const RUNBOOK_TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const RUNBOOK_TAG_MAX_LENGTH = 40;
export const RUNBOOK_TAG_MAX_COUNT = 20;

export function parseTagList(raw: string): string[] {
  const tags = raw
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}

export function isValidRunbookTag(tag: string): boolean {
  return tag.length <= RUNBOOK_TAG_MAX_LENGTH && RUNBOOK_TAG_PATTERN.test(tag);
}

export type RunbookMetadataFormFields = {
  ownerTeamId?: string | null;
  tags?: string[];
};

/** Absent fields stay undefined so partial forms never clear ownership or tags. */
export function parseRunbookMetadataForm(formData: FormData): RunbookMetadataFormFields {
  const result: RunbookMetadataFormFields = {};
  if (formData.has('ownerTeamId')) {
    const value = formData.get('ownerTeamId');
    const trimmed = typeof value === 'string' ? value.trim() : '';
    result.ownerTeamId = trimmed === '' ? null : trimmed;
  }
  if (formData.has('tags')) {
    const value = formData.get('tags');
    result.tags = parseTagList(typeof value === 'string' ? value : '');
  }
  return result;
}

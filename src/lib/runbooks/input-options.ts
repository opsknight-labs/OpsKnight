export const MAX_SELECT_OPTIONS = 50;

export function parseSelectOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((option): option is string => typeof option === 'string' && option !== '');
}

/** Returns a user-facing problem with an input's options, or null when valid. */
export function selectOptionsIssue(input: {
  type: string;
  options?: string[] | null;
  defaultValue?: string | null;
}): string | null {
  const options = input.options ?? [];
  if (input.type !== 'SELECT') {
    return options.length > 0 ? 'Only select inputs can define options.' : null;
  }
  if (options.length === 0) return 'Select inputs need at least one option.';
  if (new Set(options).size !== options.length) return 'Select options must be unique.';
  if (input.defaultValue && !options.includes(input.defaultValue)) {
    return 'The default value must be one of the options.';
  }
  return null;
}

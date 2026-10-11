import type { RunbookInputType } from './types';

// Hyphen-separated groups cannot overlap: alphanumeric groups exclude '-'.
// eslint-disable-next-line security/detect-unsafe-regex
export const SECRET_REFERENCE = /^secret:\/\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Browser and server share the same scalar value contract. No secret lookup occurs here. */
export function isValidInputValue(type: RunbookInputType | 'SELECT', value: unknown): boolean {
  switch (type) {
    case 'STRING':
    case 'SELECT':
      return typeof value === 'string' && value.length <= 2000;
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'URL':
      if (typeof value !== 'string') return false;
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    case 'DURATION':
      return typeof value === 'string' && /^\d+(?:ms|s|m|h|d)$/.test(value);
    case 'SECRET_REF':
      return typeof value === 'string' && SECRET_REFERENCE.test(value);
  }
}

export function parseInputDefault(input: {
  key: string;
  type: RunbookInputType | 'SELECT';
  required?: boolean;
  defaultValue?: string | null;
}): unknown {
  const value = input.defaultValue;
  if (value === undefined || value === null) return undefined;
  if (value === '' && !input.required) return '';
  const parsed =
    input.type === 'NUMBER' && value.trim() !== ''
      ? Number(value)
      : input.type === 'BOOLEAN' && ['true', 'false'].includes(value)
        ? value === 'true'
        : value;
  if ((input.required && value === '') || !isValidInputValue(input.type, parsed)) {
    throw new Error(
      `Runbook input "${input.key}" has an invalid ${input.type.toLowerCase()} default.`
    );
  }
  return parsed;
}

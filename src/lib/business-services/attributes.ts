import { z } from 'zod/v3';

/** Flat metadata: at most 20 keys, scalar values, keys like `cost_center` or `pci.scope`. */
export const CustomAttributesSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_.-]{0,39}$/i, 'Invalid attribute key'),
    z.union([z.string().max(200), z.number().finite(), z.boolean()])
  )
  .refine(value => Object.keys(value).length <= 20, 'At most 20 custom attributes');

/** "key = value" lines to the custom-attributes map; null when a line or the map is invalid. */
export function attributesFromLines(
  text: string
): Record<string, string | number | boolean> | null {
  const result: Record<string, string | number | boolean> = {};
  for (const line of text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)) {
    const at = line.indexOf('=');
    if (at < 1) return null;
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    // eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input
    result[key] =
      raw === 'true'
        ? true
        : raw === 'false'
          ? false
          : raw !== '' && !isNaN(Number(raw))
            ? Number(raw)
            : raw;
  }
  return CustomAttributesSchema.safeParse(result).success ? result : null;
}

export function attributesToLines(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value)
    .map(([key, entry]) => `${key} = ${String(entry)}`)
    .join('\n');
}

export type AttributeFilter = { key: string; value: string };

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_.-]{0,39}$/i;

/** "key=value" (from a URL or query string) to a filter; null when the key is not a valid attribute key. */
export function parseAttributeFilter(raw: string | null | undefined): AttributeFilter | null {
  const text = raw?.trim() ?? '';
  const at = text.indexOf('=');
  if (at < 1) return null;
  const key = text.slice(0, at).trim();
  const value = text.slice(at + 1).trim();
  if (!ATTRIBUTE_KEY.test(key) || !value || value.length > 200) return null;
  return { key, value };
}

/** The JSON values a filter value can match: the text itself, and its boolean or number reading. */
export function attributeFilterValues(value: string): Array<string | number | boolean> {
  const values: Array<string | number | boolean> = [value];
  if (value === 'true' || value === 'false') values.push(value === 'true');
  else if (!isNaN(Number(value))) values.push(Number(value));
  return values;
}

/** In-memory twin of the database filter, for counts. */
export function attributeMatches(attributes: unknown, filter: AttributeFilter): boolean {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return false;
  const stored = new Map(Object.entries(attributes)).get(filter.key);
  return attributeFilterValues(filter.value).some(candidate => candidate === stored);
}

/** Distinct "key=value" pairs across services, for a filter menu (at most `limit`, sorted). */
export function attributeOptions(rows: ReadonlyArray<unknown>, limit = 100): string[] {
  const pairs = new Set<string>();
  for (const attributes of rows) {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) continue;
    for (const [key, value] of Object.entries(attributes)) pairs.add(`${key}=${String(value)}`);
  }
  return [...pairs].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

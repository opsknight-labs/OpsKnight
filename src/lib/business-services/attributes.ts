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

import { z } from 'zod/v3';

/** Runbooks, dashboards and docs; https only, since the links render on pages as hrefs. */
export const BusinessServiceLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(value => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Links must be https URLs.'),
});

export type BusinessServiceLink = z.infer<typeof BusinessServiceLinkSchema>;

/** Stored JSON back to typed links; anything malformed is dropped rather than thrown. */
export function parseBusinessServiceLinks(value: unknown): BusinessServiceLink[] {
  if (!Array.isArray(value)) return [];
  // Per item, so one bad stored link does not blank the rest (and a save does not wipe them).
  return value.flatMap(item => {
    const parsed = BusinessServiceLinkSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Form text, one "Label | https://url" per line. Returns null when a line is invalid. */
export function linksFromLines(text: string): BusinessServiceLink[] | null {
  const links: BusinessServiceLink[] = [];
  for (const line of text
    .split('\n')
    .map(row => row.trim())
    .filter(Boolean)) {
    const cut = line.indexOf('|');
    const parsed = BusinessServiceLinkSchema.safeParse({
      label: cut < 0 ? '' : line.slice(0, cut),
      url: cut < 0 ? line : line.slice(cut + 1),
    });
    if (!parsed.success) return null;
    links.push(parsed.data);
  }
  return links.length <= 10 ? links : null;
}

export const linksToLines = (links: readonly BusinessServiceLink[]) =>
  links.map(link => `${link.label} | ${link.url}`).join('\n');

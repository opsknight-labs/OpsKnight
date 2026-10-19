import { schedulingLabelsSchema } from './labels';

/** Flat selector JSON must never silently discard duplicate labels. */
export function parseAgentSelector(
  raw: unknown
): { success: true; data: Record<string, string> } | { success: false; error: string } {
  const error = 'Selector must contain at most 32 unique valid label keys and string values.';
  if (typeof raw !== 'string' || raw.length > 16384) return { success: false, error };
  try {
    const parsed = schedulingLabelsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { success: false, error };
    // Once validated as a flat string map, JSON string tokens alternate key/value.
    // Tokenizing whole strings avoids mistaking escaped quotes in values for keys.
    const strings = Array.from(raw.matchAll(/"(?:\\.|[^"\\])*"/g), match => match[0]);
    const keys = strings
      .filter((_, index) => index % 2 === 0)
      .map(value => JSON.parse(value) as string);
    if (new Set(keys).size !== keys.length) return { success: false, error };
    return { success: true, data: parsed.data };
  } catch {
    return { success: false, error };
  }
}

import { isSensitiveValue } from './context/privacy';
import { forbiddenSegment } from './context/extract';
export type Observation = {
  key: string;
  path: string;
  value: string;
  type: string;
  unmapped: boolean;
};
/** Bounded scalar-only traversal for samples/async discovery; never persist payloads. */
export function discoverFields(payload: unknown): Observation[] {
  const fields: Observation[] = [];
  let visited = 0;
  const visit = (value: unknown, tokens: string[], depth: number) => {
    if (++visited > 256 || fields.length >= 64 || depth > 6) return;
    if (value === null || value === undefined) return;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      const text = String(value);
      if (!tokens.length || text.length > 256 || isSensitiveValue(text)) return;
      fields.push({
        key: tokens
          .join('_')
          .replace(/[^a-zA-Z0-9_]/g, '_')
          .toLowerCase()
          .slice(0, 64),
        path: tokens.join('.'),
        value: text,
        type:
          typeof value === 'number' ? 'NUMBER' : typeof value === 'boolean' ? 'BOOLEAN' : 'STRING',
        unmapped: false,
      });
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value
        .slice(0, 4)
        .forEach((item, index) =>
          visit(item, [...tokens.slice(0, -1), `${tokens.at(-1)}[${index}]`], depth + 1)
        );
      return;
    }
    for (const [key, child] of Object.entries(value))
      if (/^[A-Za-z_][\w-]*$/.test(key) && !forbiddenSegment(key))
        visit(child, [...tokens, key], depth + 1);
  };
  visit(payload, [], 0);
  return fields;
}

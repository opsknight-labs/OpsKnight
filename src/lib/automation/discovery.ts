import { isSensitiveValue } from './context/privacy';
import { forbiddenSegment } from './context/extract';
export type Observation = {
  key: string;
  path: string;
  value: string;
  type: string;
  unmapped: boolean;
};

/** Formats a dotted or bracketed path into a readable hierarchical title, e.g. repository.name -> Repository Name */
export function formatHierarchicalLabel(path: string): string {
  let cleaned = path.replace(/^\$\.?/, '').replace(/^\[\d+\]\.?/, '');
  if (cleaned.startsWith('payload.custom_details.')) {
    cleaned = cleaned.slice('payload.custom_details.'.length);
  } else if (cleaned.startsWith('payload.')) {
    cleaned = cleaned.slice('payload.'.length);
  }
  const segments = cleaned
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .filter(seg => !/^\d+$/.test(seg));
  if (!segments.length) return 'Item';
  return segments
    .flatMap(seg =>
      seg
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[_-\s]+/)
    )
    .filter(Boolean)
    .map(word => {
      const lower = word.toLowerCase();
      if (['id', 'arn', 'url', 'uri', 'ip', 'aws'].includes(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Formats a path into a unique, stable snake_case identifier starting with [a-z]. */
export function formatObservationKey(tokens: string[]): string {
  let cleanTokens = tokens.map(t => t.replace(/^\[\d+\]$/, '')).filter(Boolean);
  if (cleanTokens[0] === 'payload') {
    cleanTokens = cleanTokens.slice(1);
    if (cleanTokens[0] === 'custom_details') {
      cleanTokens = cleanTokens.slice(1);
    }
  }
  const rawKey = cleanTokens
    .join('_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 64);
  if (!rawKey) return 'item';
  return /^[a-z]/.test(rawKey) ? rawKey : `item_${rawKey}`;
}

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
      const path = tokens.join('.');
      fields.push({
        key: formatObservationKey(tokens),
        path,
        value: text,
        type:
          typeof value === 'number' ? 'NUMBER' : typeof value === 'boolean' ? 'BOOLEAN' : 'STRING',
        unmapped: false,
      });
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.slice(0, 4).forEach((item, index) => {
        const nextTokens =
          tokens.length === 0
            ? [`[${index}]`]
            : [...tokens.slice(0, -1), `${tokens.at(-1)}[${index}]`];
        visit(item, nextTokens, depth + 1);
      });
      return;
    }
    for (const [key, child] of Object.entries(value))
      if (/^[A-Za-z_][\w-]*$/.test(key) && !forbiddenSegment(key))
        visit(child, [...tokens, key], depth + 1);
  };
  visit(payload, [], 0);
  return fields;
}

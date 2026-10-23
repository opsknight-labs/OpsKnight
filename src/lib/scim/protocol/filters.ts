import { ScimFailure } from './validation';
/** Bounded equality subset. JSON string decoding preserves escaped directory identifiers. */
export function equalityFilter(filter: string | null, attributes: string[]) {
  if (!filter) return null;
  if (filter.length > 2048)
    throw new ScimFailure(400, 'Filter exceeds the supported size.', 'invalidFilter');
  let source = filter.trim();
  if (source.startsWith('(') && source.endsWith(')')) source = source.slice(1, -1).trim();
  const match = /^([a-z][a-z0-9]*)\s+eq\s+(.+)$/i.exec(source);
  if (!match || !attributes.includes(match[1].toLowerCase()))
    throw new ScimFailure(400, 'Unsupported SCIM equality filter.', 'invalidFilter');
  const literal = match[2];
  let value: unknown;
  try {
    value = literal.startsWith('"')
      ? JSON.parse(literal)
      : /^'[^'\r\n]+'$/.test(literal)
        ? literal.slice(1, -1)
        : undefined;
  } catch {
    throw new ScimFailure(400, 'Malformed filter string literal.', 'invalidFilter');
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 320 || /[\r\n\0]/.test(value))
    throw new ScimFailure(400, 'Invalid SCIM filter value.', 'invalidFilter');
  return { attribute: match[1].toLowerCase(), value: value.trim() };
}

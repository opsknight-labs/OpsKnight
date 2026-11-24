import type { PayloadFormat } from './types';

/**
 * The format layer: whatever a tool sent (JSON, a ClickHouse literal, XML, logfmt, form data, "Key: value"
 * lines, Markdown, plain text) becomes structured data, and structure hidden inside string values (JSON in a
 * string, ClickHouse output, templated multi-line annotations) is expanded. Bounded: depth and size limits keep
 * a hostile payload from costing more than a normal one.
 */

const MAX_INPUT = 256_000;
const MAX_DEPTH = 8;
/** Heuristic text formats (logfmt, form, key/value, XML) are only tried below this size: their scans are not linear. */
const MAX_HEURISTIC = 20_000;

export type Parsed = { format: PayloadFormat; data: unknown };

/** ClickHouse prints Map, Array and Tuple values as `{'k':1}`, `['a','b']`, `('x',1)`: rewrite as JSON. */
export function clickHouseLiteralToJson(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[[{(][\s\S]*[\]})]$/.test(trimmed) || !trimmed.includes("'")) return null;
  let out = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charAt(i);
    if (ch === "'") {
      let value = '';
      for (i++; i < trimmed.length && trimmed.charAt(i) !== "'"; i++) {
        value += trimmed.charAt(i) === '\\' ? trimmed.charAt(++i) : trimmed.charAt(i);
      }
      out += JSON.stringify(value);
    } else {
      out += ch === '(' ? '[' : ch === ')' ? ']' : ch;
    }
  }
  try {
    return JSON.stringify(JSON.parse(out), null, 2);
  } catch {
    return null;
  }
}

function tryJson(text: string): unknown {
  const t = text.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))))
    return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function tryLiteral(text: string): unknown {
  const json = clickHouseLiteralToJson(text);
  return json ? JSON.parse(json) : undefined;
}

/** `level=error host="db 1" msg=timeout`: logfmt, when most tokens are key=value. */
function tryLogfmt(text: string): Record<string, string> | undefined {
  if (text.includes('\n') && text.split('\n').filter(Boolean).length > 1) return undefined;
  const pairs = [...text.matchAll(/([\w.\-/]+)=("(?:[^"\\]|\\.)*"|\S*)/g)];
  if (pairs.length < 2) return undefined;
  const covered = pairs.reduce((n, m) => n + m[0].length, 0);
  if (covered < text.replace(/\s+/g, '').length * 0.6) return undefined;
  const out: Record<string, string> = {};
  for (const [, key, raw] of pairs) {
    out[key] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
  }
  return out;
}

/** `a=1&b=two`: form-encoded, one line, no spaces. */
function tryForm(text: string): Record<string, string> | undefined {
  if (!/^[^\s&=]+=[^\s&]*(&[^\s&=]+=[^\s&]*)+$/.test(text)) return undefined;
  try {
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return undefined;
  }
}

/** "Key: value" lines, with indentation as nesting (covers simple YAML). */
function tryKeyValue(text: string): Record<string, unknown> | undefined {
  const lines = text.split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
  if (lines.length < 2) return undefined;
  const kv = lines.filter(
    line => /^\s*[-\w .()/]{1,60}:(\s|$)/.test(line) && !/^\s*https?:/.test(line)
  );
  if (kv.length < Math.max(2, lines.length * 0.6)) return undefined;
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; node: Record<string, unknown> }> = [
    { indent: -1, node: root },
  ];
  // A key with an empty value ("Additional Info:") takes the free text that follows it; other free text
  // ("Problem started at 10:02 on 2026.11.22", "[PROBLEM] db-1 is CRITICAL") is kept under "text".
  const loose: string[] = [];
  let open: {
    parent: Record<string, unknown>;
    key: string;
    child: Record<string, unknown>;
  } | null = null;
  for (const line of lines) {
    const match = /^\s*https?:/.test(line)
      ? null
      : line.match(/^(\s*)(?:-\s+)?([-\w .()/]{1,60}):(?:\s+(.*))?$/);
    if (!match) {
      if (open && Object.keys(open.child).length === 0) {
        const prev = open.parent[open.key];
        open.parent[open.key] = typeof prev === 'string' ? `${prev}\n${line.trim()}` : line.trim();
      } else loose.push(line.trim());
      continue;
    }
    const indent = match[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const key = match[2].trim();
    const value = (match[3] ?? '').trim().replace(/^["']|["']$/g, '');
    if (value === '') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, node: child });
      open = { parent, key, child };
    } else {
      parent[key] = value;
      open = null;
    }
  }
  if (loose.length && root.text === undefined) root.text = loose.join('\n');
  return Object.keys(root).length ? root : undefined;
}

/** A small, tolerant XML reader: elements become keys, repeated elements arrays, attributes "@name". */
function tryXml(text: string): Record<string, unknown> | undefined {
  const t = text.trim();
  if (!t.startsWith('<') || !t.endsWith('>')) return undefined;
  const body = t
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const tokens = body.match(/<\/?[A-Za-z_][\w:.-]*(?:\s[^>]*)?\/?>|[^<]+/g);
  if (!tokens) return undefined;
  type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string };
  const root: Node = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: Node[] = [root];
  for (const token of tokens) {
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
    } else if (token.startsWith('<')) {
      const name = token.match(/^<([A-Za-z_][\w:.-]*)/)?.[1] ?? 'node';
      const attrs: Record<string, string> = {};
      for (const [, k, v] of token.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[k] = v;
      const node: Node = { name, attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else if (token.trim()) stack[stack.length - 1].text += token.trim();
  }
  const toValue = (node: Node): unknown => {
    if (!node.children.length && !Object.keys(node.attrs).length) return decodeXml(node.text);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.attrs)) out[`@${k}`] = decodeXml(v);
    for (const child of node.children) {
      const value = toValue(child);
      const existing = out[child.name];
      out[child.name] =
        existing === undefined
          ? value
          : Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
    }
    if (node.text) out['#text'] = decodeXml(node.text);
    return out;
  };
  if (!root.children.length) return undefined;
  return toValue(root) as Record<string, unknown>;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)#{1,6}\s|\*\*[^*]+\*\*|(^|\n)\s*[-*]\s|\[[^\]]+\]\(https?:\/\/|`[^`]+`/.test(text);
}

/** Expands strings that hide structure (JSON, literals) inside an already parsed value. */
function expand(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.length > 1 && t.length < MAX_HEURISTIC * 5) {
      const json = tryJson(t);
      if (json !== undefined) return expand(json, depth + 1);
      const literal = tryLiteral(t);
      if (literal !== undefined) return expand(literal, depth + 1);
    }
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 500).map(item => expand(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (n++ >= 500) break;
      out[k] = expand(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Any raw input (an already parsed object, or text in any of the supported formats) → structured data. */
export function parseAny(raw: unknown): Parsed {
  if (raw !== null && typeof raw === 'object') return { format: 'json', data: expand(raw) };
  if (typeof raw !== 'string') return { format: 'text', data: raw == null ? '' : String(raw) };
  const text = raw.length > MAX_INPUT ? raw.slice(0, MAX_INPUT) : raw;
  const trimmed = text.trim();
  const json = tryJson(trimmed);
  if (json !== undefined) return { format: 'json', data: expand(json) };
  const literal = tryLiteral(trimmed);
  if (literal !== undefined) return { format: 'literal', data: expand(literal) };
  if (trimmed.length <= MAX_HEURISTIC) {
    const xml = trimmed.startsWith('<') ? tryXml(trimmed) : undefined;
    if (xml) return { format: 'xml', data: expand(xml) };
    if (trimmed.includes('=')) {
      const form = tryForm(trimmed);
      if (form) return { format: 'form', data: expand(form) };
      const logfmt = tryLogfmt(trimmed);
      if (logfmt) return { format: 'logfmt', data: expand(logfmt) };
    }
    if (trimmed.includes(':')) {
      const kv = tryKeyValue(trimmed);
      if (kv) return { format: 'kv', data: expand(kv) };
    }
  }
  return {
    format: trimmed.length <= MAX_HEURISTIC && looksLikeMarkdown(trimmed) ? 'markdown' : 'text',
    data: trimmed,
  };
}

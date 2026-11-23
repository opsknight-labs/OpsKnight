import { sanitizeProviderData } from '@/lib/integrations/payload-security';
import { parseAny } from './formats';
import { asTime, emptyReadable, isHttpUrl, readGeneric } from './generic';
import { SOURCE_READERS } from './sources';
import type { ReadablePayload, SourceReader } from './types';

export type { ReadablePayload } from './types';

/**
 * Any raw alert payload → one readable view, without AI. Credentials are masked before anything is read, a
 * matching source reader (by shape) wins on the fields it knows, and the generic reader fills the rest. Never
 * throws: a reader failing on an odd shape falls back to the generic view.
 */
export function readPayload(raw: unknown, options: { sourceHint?: string } = {}): ReadablePayload {
  const { format, data } = parseAny(raw);
  const safe = sanitizeProviderData(data);
  let base: Omit<ReadablePayload, 'format' | 'source'>;
  try {
    base = readGeneric(safe);
  } catch {
    base = { ...emptyReadable(), message: typeof safe === 'string' ? safe : null };
  }
  const reader = pickReader(safe, options.sourceHint);
  if (!reader) return { format, source: null, ...base };
  let specific: ReturnType<SourceReader['read']> = {};
  try {
    specific = reader.read(safe as Record<string, unknown>);
  } catch {
    specific = {};
  }
  return { format, source: { id: reader.id, name: reader.name }, ...merge(base, specific) };
}

function pickReader(data: unknown, hint?: string): SourceReader | null {
  if (hint) {
    const hinted = SOURCE_READERS.find(r => r.id === hint);
    if (hinted) return hinted;
  }
  for (const reader of SOURCE_READERS) {
    try {
      if (reader.detect(data)) return reader;
    } catch {
      // a detector must never break the page
    }
  }
  return null;
}

function uniqBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Source fields override the generic ones; lists are combined (source first) without duplicates. */
function merge(
  base: Omit<ReadablePayload, 'format' | 'source'>,
  specific: ReturnType<SourceReader['read']>
): Omit<ReadablePayload, 'format' | 'source'> {
  const pick = <K extends keyof typeof base>(k: K) =>
    (specific[k] ?? null) !== null && specific[k] !== ''
      ? (specific[k] as (typeof base)[K])
      : base[k];
  const links = uniqBy(
    [...(specific.links ?? []), ...base.links].filter(l => isHttpUrl(l.url)),
    l => l.url
  );
  const when = uniqBy(
    [...(specific.when ?? []), ...base.when]
      .map(t => ({ label: t.label, at: asTime(t.at) ?? t.at }))
      .filter(t => !Number.isNaN(Date.parse(t.at))),
    t => t.label
  );
  const shown = new Set(
    [specific.title, specific.message, specific.condition, specific.query?.text].filter(
      Boolean
    ) as string[]
  );
  return {
    title: pick('title'),
    status: pick('status'),
    severity: pick('severity'),
    condition: pick('condition'),
    measured: pick('measured'),
    query: pick('query'),
    message: pick('message'),
    where: uniqBy([...(specific.where ?? []), ...base.where], f => f.label),
    when,
    links,
    images: uniqBy([...(specific.images ?? []), ...base.images].filter(isHttpUrl), u => u),
    tags: uniqBy([...(specific.tags ?? []), ...base.tags], t => t).slice(0, 40),
    // A leftover equal to something the source reader already shows is noise.
    fields: base.fields.filter(f => !shown.has(f.value)),
  };
}

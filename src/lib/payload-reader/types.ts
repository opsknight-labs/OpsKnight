/**
 * A readable view of any alert payload, built without AI: a format layer turns the raw input into structured
 * data, a source reader (Datadog, Grafana, Alertmanager, …) reads the fields that tool is known to send, and a
 * generic reader fills everything else by key names and value shapes. Plain, serialisable data only, so a
 * server component can build it and a client component can render it.
 */

/** The input format the raw payload was in. */
export type PayloadFormat =
  | 'json'
  | 'literal' // ClickHouse / Python-style literals: {'A':5400,'B':1}
  | 'xml'
  | 'logfmt' // level=error host=db-1 msg="…"
  | 'form' // a=1&b=2
  | 'kv' // "Key: value" lines (and YAML-like nesting)
  | 'markdown'
  | 'text';

export type PayloadStatus = 'firing' | 'resolved' | 'acknowledged' | 'info';

export type ReadableField = { label: string; value: string };
export type ReadableTime = { label: string; at: string };
export type ReadableLink = { label: string; url: string };

export type ReadablePayload = {
  format: PayloadFormat;
  /** The tool that sent it, when a source reader recognised the shape. */
  source: { id: string; name: string } | null;
  title: string | null;
  status: PayloadStatus | null;
  /** Lower-case severity / priority as the source names it ("critical", "p1", "warning"). */
  severity: string | null;
  /** The rule in words: "5xx rate above 5% on POST /v1/checkout". */
  condition: string | null;
  measured: { value: string; threshold: string | null } | null;
  query: { language: string | null; text: string } | null;
  /** Host, service, env, region, cluster… */
  where: ReadableField[];
  when: ReadableTime[];
  links: ReadableLink[];
  images: string[];
  /** "key:value" or bare tags. */
  tags: string[];
  /** The source's own message, as text (Markdown is kept as written). */
  message: string | null;
  /** Everything not shown above, as readable paths ("monitor.priority"). */
  fields: ReadableField[];
};

/** A per-tool reader: recognises its payloads by shape and reads the fields that tool sends. */
export type SourceReader = {
  id: string;
  name: string;
  detect: (data: unknown) => boolean;
  read: (data: Record<string, unknown>) => Partial<Omit<ReadablePayload, 'format' | 'source'>>;
};

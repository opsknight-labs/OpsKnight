/**
 * Pure normalisation of connector responses into compact summaries a model can read in a few hundred tokens.
 * Nothing here touches the network; adapters parse vendor JSON into these shapes and these functions bound
 * them. Every list has a fixed cap and every free-text field a fixed length.
 */

export interface TimeWindow {
  start: Date;
  end: Date;
}

// Sized so a full summary stays well inside the gateway's tool-output cap, so nothing is cut mid-structure.
export const LIMITS = {
  series: 8,
  samplesPerSeries: 5,
  labelsPerSeries: 6,
  labelsPerLogLine: 3,
  labelValueLength: 80,
  logLines: 15,
  logLineLength: 240,
  traces: 3,
  spansPerTrace: 20,
  issues: 10,
  diffFiles: 25,
  patchChars: 3_000,
} as const;

const clip = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
export const clipText = clip;

const round = (value: number) =>
  Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : null;
const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export const windowView = (window: TimeWindow) => ({
  start: window.start.toISOString(),
  end: window.end.toISOString(),
});

/* ----------------------------------------------------------------------------------------------- metrics */

export interface RawSeries {
  labels: Record<string, unknown>;
  /** [epoch milliseconds, value] */
  points: Array<[number, number]>;
}

export interface MetricsSummary {
  kind: 'metrics';
  query: string;
  window: { start: string; end: string };
  seriesCount: number;
  series: Array<{
    labels: Record<string, string>;
    points: number;
    first: number | null;
    last: number | null;
    min: number | null;
    max: number | null;
    mean: number | null;
    /** The largest absolute change between consecutive samples and when it happened. */
    biggestChange: { at: string | null; delta: number | null } | null;
    samples: Array<{ at: string | null; value: number | null }>;
  }>;
  truncated: boolean;
}

function compactLabels(
  labels: Record<string, unknown>,
  max: number = LIMITS.labelsPerSeries
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .slice(0, max)
      .map(([key, value]) => [clip(key, 60), clip(value, LIMITS.labelValueLength)])
  );
}

/** Evenly spaced picks, always including the first and last point. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const picks: T[] = [];
  for (let i = 0; i < count; i += 1)
    picks.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
  return picks;
}

export function summarizeSeries(
  query: string,
  window: TimeWindow,
  raw: readonly RawSeries[]
): MetricsSummary {
  const series = raw.slice(0, LIMITS.series).map(item => {
    const points = item.points.filter(
      ([at, value]) => Number.isFinite(at) && Number.isFinite(value)
    );
    const values = points.map(([, value]) => value);
    let biggest: { at: number; delta: number } | null = null;
    let previous: number | null = null;
    for (const [at, value] of points) {
      const delta = previous === null ? null : value - previous;
      previous = value;
      if (delta !== null && (!biggest || Math.abs(delta) > Math.abs(biggest.delta)))
        biggest = { at, delta };
    }
    return {
      labels: compactLabels(item.labels),
      points: points.length,
      first: values.length ? round(values[0]) : null,
      last: values.length ? round(values[values.length - 1]) : null,
      min: values.length ? round(Math.min(...values)) : null,
      max: values.length ? round(Math.max(...values)) : null,
      mean: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      biggestChange: biggest ? { at: iso(biggest.at), delta: round(biggest.delta) } : null,
      samples: spread(points, LIMITS.samplesPerSeries).map(([at, value]) => ({
        at: iso(at),
        value: round(value),
      })),
    };
  });
  return {
    kind: 'metrics',
    query: clip(query, 500),
    window: windowView(window),
    seriesCount: raw.length,
    series,
    truncated: raw.length > LIMITS.series,
  };
}

/* -------------------------------------------------------------------------------------------------- logs */

export interface RawLogLine {
  /** epoch milliseconds */
  at: number;
  text: unknown;
  labels?: Record<string, unknown>;
}

export interface LogsSummary {
  kind: 'logs';
  query: string;
  window: { start: string; end: string };
  matched: number;
  lines: Array<{ at: string | null; text: string; labels?: Record<string, string> }>;
  truncated: boolean;
}

export function summarizeLogs(
  query: string,
  window: TimeWindow,
  raw: readonly RawLogLine[],
  matched?: number
): LogsSummary {
  const sorted = [...raw].sort((a, b) => b.at - a.at);
  return {
    kind: 'logs',
    query: clip(query, 500),
    window: windowView(window),
    matched: matched ?? raw.length,
    lines: sorted.slice(0, LIMITS.logLines).map(line => ({
      at: iso(line.at),
      text: clip(line.text, LIMITS.logLineLength),
      ...(line.labels && Object.keys(line.labels).length
        ? { labels: compactLabels(line.labels, LIMITS.labelsPerLogLine) }
        : {}),
    })),
    truncated: (matched ?? raw.length) > LIMITS.logLines,
  };
}

/* ------------------------------------------------------------------------------------------------ traces */

export interface RawSpan {
  traceId: string;
  spanId: string;
  parentId?: string | null;
  service: unknown;
  name: unknown;
  /** epoch milliseconds */
  startMs: number;
  durationMs: number;
  error: boolean;
}

export interface TracesSummary {
  kind: 'traces';
  window: { start: string; end: string };
  traces: Array<{
    traceId: string;
    rootService: string;
    rootName: string;
    startedAt: string | null;
    durationMs: number | null;
    spanCount: number;
    errorCount: number;
    services: string[];
    /** The span tree, depth-first, slowest children first, capped. */
    spans: Array<{
      depth: number;
      service: string;
      name: string;
      durationMs: number | null;
      error: boolean;
    }>;
    truncated: boolean;
  }>;
  truncated: boolean;
}

export function summarizeTraces(window: TimeWindow, raw: readonly RawSpan[]): TracesSummary {
  const byTrace = new Map<string, RawSpan[]>();
  for (const span of raw) {
    const list = byTrace.get(span.traceId) ?? [];
    list.push(span);
    byTrace.set(span.traceId, list);
  }
  const traces = [...byTrace.entries()].slice(0, LIMITS.traces).map(([traceId, spans]) => {
    const ids = new Set(spans.map(span => span.spanId));
    const children = new Map<string, RawSpan[]>();
    const roots: RawSpan[] = [];
    for (const span of spans) {
      if (span.parentId && ids.has(span.parentId)) {
        const list = children.get(span.parentId) ?? [];
        list.push(span);
        children.set(span.parentId, list);
      } else roots.push(span);
    }
    const ordered: TracesSummary['traces'][number]['spans'] = [];
    const visit = (span: RawSpan, depth: number) => {
      if (ordered.length >= LIMITS.spansPerTrace || depth > 20) return;
      ordered.push({
        depth,
        service: clip(span.service, 80),
        name: clip(span.name, 120),
        durationMs: round(span.durationMs),
        error: span.error,
      });
      for (const child of [...(children.get(span.spanId) ?? [])].sort(
        (a, b) => b.durationMs - a.durationMs
      ))
        visit(child, depth + 1);
    };
    roots.sort((a, b) => a.startMs - b.startMs).forEach(root => visit(root, 0));
    const root = roots[0] ?? spans[0];
    const start = Math.min(...spans.map(span => span.startMs));
    const end = Math.max(...spans.map(span => span.startMs + span.durationMs));
    return {
      traceId: clip(traceId, 64),
      rootService: clip(root?.service, 80),
      rootName: clip(root?.name, 120),
      startedAt: iso(start),
      durationMs: round(end - start),
      spanCount: spans.length,
      errorCount: spans.filter(span => span.error).length,
      services: [...new Set(spans.map(span => clip(span.service, 80)))].slice(0, 10),
      spans: ordered,
      truncated: spans.length > ordered.length,
    };
  });
  return {
    kind: 'traces',
    window: windowView(window),
    traces,
    truncated: byTrace.size > LIMITS.traces,
  };
}

/* ------------------------------------------------------------------------------------------------ errors */

export interface RawIssue {
  id: unknown;
  title: unknown;
  culprit?: unknown;
  level?: unknown;
  status?: unknown;
  count?: unknown;
  userCount?: unknown;
  firstSeen?: unknown;
  lastSeen?: unknown;
  permalink?: unknown;
}

export interface ErrorsSummary {
  kind: 'errors';
  query: string;
  window: { start: string; end: string };
  issues: Array<{
    id: string;
    title: string;
    culprit: string;
    level: string;
    status: string;
    events: number | null;
    usersAffected: number | null;
    firstSeen: string;
    lastSeen: string;
    link: string;
  }>;
  truncated: boolean;
}

const count = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

export function summarizeIssues(
  query: string,
  window: TimeWindow,
  raw: readonly RawIssue[]
): ErrorsSummary {
  return {
    kind: 'errors',
    query: clip(query, 300),
    window: windowView(window),
    issues: raw.slice(0, LIMITS.issues).map(issue => ({
      id: clip(issue.id, 64),
      title: clip(issue.title, 200),
      culprit: clip(issue.culprit, 200),
      level: clip(issue.level, 20),
      status: clip(issue.status, 20),
      events: count(issue.count),
      usersAffected: count(issue.userCount),
      firstSeen: clip(issue.firstSeen, 40),
      lastSeen: clip(issue.lastSeen, 40),
      link: /^https:\/\//.test(String(issue.permalink ?? '')) ? clip(issue.permalink, 300) : '',
    })),
    truncated: raw.length > LIMITS.issues,
  };
}

/* -------------------------------------------------------------------------------------------------- diff */

export interface RawDiffFile {
  path: unknown;
  status?: unknown;
  additions?: unknown;
  deletions?: unknown;
  patch?: unknown;
}

export interface DiffSummary {
  kind: 'diff';
  provider: 'github' | 'gitlab';
  ref: string;
  title: string;
  url: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  /** Unified patch of the first files, truncated to a fixed length. */
  patch: string;
  truncated: boolean;
}

/** Counts added and removed lines of a unified diff hunk when the API does not report them. */
export function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

export function summarizeDiff(input: {
  provider: 'github' | 'gitlab';
  ref: string;
  title: unknown;
  url: string;
  files: readonly RawDiffFile[];
  totalFiles?: number;
}): DiffSummary {
  const files = input.files.map(file => {
    const patch = typeof file.patch === 'string' ? file.patch : '';
    const counted = countPatchLines(patch);
    return {
      path: clip(file.path, 300),
      status: clip(file.status ?? 'modified', 20),
      additions: count(file.additions) ?? counted.additions,
      deletions: count(file.deletions) ?? counted.deletions,
      patch,
    };
  });
  let patch = '';
  for (const file of files) {
    if (!file.patch || patch.length >= LIMITS.patchChars) continue;
    patch += `--- ${file.path}\n${file.patch}\n`;
  }
  const truncatedPatch = patch.length > LIMITS.patchChars;
  return {
    kind: 'diff',
    provider: input.provider,
    ref: clip(input.ref, 120),
    title: clip(input.title, 200),
    url: clip(input.url, 500),
    filesChanged: input.totalFiles ?? files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files: files.slice(0, LIMITS.diffFiles).map(({ patch: _patch, ...file }) => file),
    patch: truncatedPatch ? `${patch.slice(0, LIMITS.patchChars)}\n… [patch truncated]` : patch,
    truncated: truncatedPatch || files.length > LIMITS.diffFiles,
  };
}

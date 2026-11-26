import type {
  PayloadStatus,
  ReadableField,
  ReadableLink,
  ReadablePayload,
  ReadableTime,
} from './types';

/**
 * The generic reader: classifies every field of any structured payload by its key and the shape of its value.
 * Source readers then override what they know better; this is the floor every payload gets.
 */

const MAX_FIELDS = 400;
const MAX_LEFTOVER = 60;
const MAX_VALUE = 600;

type Leaf = { path: string[]; key: string; value: string | number | boolean };

/** "dashboard_url", "dashboardURL", "Dashboard URL" → "dashboardurl". */
export function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function flatten(value: unknown, path: string[] = [], out: Leaf[] = [], depth = 0): Leaf[] {
  if (out.length >= MAX_FIELDS || depth > 10) return out;
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push({ path, key: path[path.length - 1] ?? '', value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, [...path, String(i)], out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, [...path, k], out, depth + 1);
  }
  return out;
}

const keySet = (...keys: string[]) => new Set(keys.map(normKey));

const TITLE = keySet(
  'title',
  'alertname',
  'alert_name',
  'alert_title',
  'rule_name',
  'rulename',
  'monitor_name',
  'check_name',
  'event_title',
  'incident_title',
  'headline',
  'subject',
  'summary',
  'AlarmName',
  'issue_title',
  'name'
);
const MESSAGE = keySet(
  'message',
  'description',
  'body',
  'text',
  'details',
  'alert_message',
  'msg',
  'long_description',
  'event_message',
  'NewStateReason',
  'output',
  'plugin_output',
  'reason'
);
const STATUS = keySet(
  'status',
  'state',
  'alert_state',
  'current_state',
  'NewStateValue',
  'event_type',
  'action',
  'trigger_status',
  'alertstatus',
  'condition_status',
  'incident_state'
);
const SEVERITY = keySet(
  'severity',
  'priority',
  'level',
  'urgency',
  'criticality',
  'alert_priority',
  'sev',
  'severity_level',
  'alert_severity'
);
const WHERE: Record<string, string> = {
  host: 'Host',
  hostname: 'Host',
  instance: 'Instance',
  node: 'Node',
  nodename: 'Node',
  pod: 'Pod',
  podname: 'Pod',
  namespace: 'Namespace',
  cluster: 'Cluster',
  container: 'Container',
  service: 'Service',
  servicename: 'Service',
  app: 'App',
  application: 'Application',
  env: 'Env',
  environment: 'Env',
  region: 'Region',
  zone: 'Zone',
  availabilityzone: 'Zone',
  datacenter: 'Datacenter',
  dc: 'Datacenter',
  job: 'Job',
  endpoint: 'Endpoint',
  resource: 'Resource',
  resourcename: 'Resource',
  project: 'Project',
  account: 'Account',
  accountid: 'Account',
  subscription: 'Subscription',
  database: 'Database',
  db: 'Database',
  table: 'Table',
  topic: 'Topic',
  queue: 'Queue',
  team: 'Team',
  component: 'Component',
  device: 'Device',
};
const VALUE = keySet(
  'value',
  'current_value',
  'metric_value',
  'observed',
  'observed_value',
  'actual',
  'last_value',
  'evalmatches',
  'triggered_value',
  'value_string',
  'valuestring'
);
const THRESHOLD = keySet(
  'threshold',
  'critical_threshold',
  'warning_threshold',
  'limit',
  'threshold_value'
);
const QUERY = keySet(
  'query',
  'expr',
  'expression',
  'promql',
  'sql',
  'nrql',
  'search',
  'filter',
  'kql',
  'logql',
  'spl',
  'query_string',
  'condition_query'
);
const CONDITION = keySet(
  'condition',
  'condition_name',
  'conditionname',
  'trigger',
  'rule',
  'comparison'
);

const LINK_LABEL: Array<[RegExp, string]> = [
  [/runbook|playbook/, 'Runbook'],
  [/dashboard/, 'Dashboard'],
  [/panel/, 'Panel'],
  [/silence/, 'Silence'],
  [
    /generator|source|alerturl|monitorurl|link|url|href|permalink|weburl|html_url/,
    'Open in source',
  ],
];

const IMAGE_KEY = /image|snapshot|graph|chart|screenshot/;

export function normalizeStatus(value: string): PayloadStatus | null {
  const v = value.trim().toLowerCase();
  if (
    /^(firing|fired|alerting|alarm|triggered|trigger|open|opened|problem|critical|down|active|activated|fail|failed|failure|error|raised|new|created|anomalous|unresolved|reopened|investigating|identified|degraded|trouble)$/.test(
      v
    )
  )
    return 'firing';
  if (
    /^(resolved|resolve|ok|okay|recovered|recovery|closed|normal|up|cleared|clear|success|succeeded|inactive|deactivated|merged)$/.test(
      v
    )
  )
    return 'resolved';
  if (/^(acknowledged|acknowledge|ack|acked|snoozed)$/.test(v)) return 'acknowledged';
  if (
    /^(info|informational|notice|warning_cleared|insufficient_data|upcoming|scheduled|canceled|cancelled)$/.test(
      v
    )
  )
    return 'info';
  return null;
}

const EPOCH_MIN = Date.UTC(2000, 0, 1);
const EPOCH_MAX = Date.UTC(2100, 0, 1);

/** ISO strings and epoch seconds / milliseconds in a plausible range → ISO. */
export function asTime(value: string | number | boolean): string | null {
  if (typeof value === 'boolean') return null;
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored digits only, no ambiguous repetition
  if (typeof value === 'number' || /^\d{10}(\d{3})?(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    const ms = n < 1e11 ? n * 1000 : n;
    return ms > EPOCH_MIN && ms < EPOCH_MAX ? new Date(ms).toISOString() : null;
  }
  const s = String(value);
  // ISO, or an RFC 2822 date ("Fri, 27 Jan 2023 06:02:51 GMT") — anything with a 4-digit year and a clock time.
  if (
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) &&
    !(/\b\d{4}\b/.test(s) && /\d{1,2}:\d{2}/.test(s))
  )
    return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && ms > EPOCH_MIN && ms < EPOCH_MAX
    ? new Date(ms).toISOString()
    : null;
}

const TIME_KEY =
  /(^|_)(at|time|timestamp|date|ts|since|until)$|startsat|endsat|started|ended|fired|triggered|resolved|created|updated|last_?seen|first_?seen|occurred|changed/;

function timeLabel(key: string): string {
  const k = key.toLowerCase();
  if (/resolv|endsat|ended|recover|clear/.test(k)) return 'Resolved';
  if (/start|fired|trigger|occur|created|first/.test(k)) return 'Started';
  if (/last|updated|changed/.test(k)) return 'Last update';
  return humanKey(key);
}

/** "dashboard_url" → "Dashboard url", "startsAt" → "Starts at". */
export function humanKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function clip(value: string): string {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s<>"]+$/i.test(value.trim());
}

export function emptyReadable(): Omit<ReadablePayload, 'format' | 'source'> {
  return {
    title: null,
    status: null,
    severity: null,
    condition: null,
    measured: null,
    query: null,
    where: [],
    when: [],
    links: [],
    images: [],
    tags: [],
    message: null,
    fields: [],
  };
}

/** Classifies every leaf of `data`. Anything unclassified is returned as a readable path. */
export function readGeneric(data: unknown): Omit<ReadablePayload, 'format' | 'source'> {
  const out = emptyReadable();
  if (typeof data === 'string') {
    out.message = data || null;
    return out;
  }
  const leaves = flatten(data);
  const used = new Set<Leaf>();
  const take = (leaf: Leaf) => used.add(leaf);
  const depthOf = (leaf: Leaf) => leaf.path.length;
  // Shallower keys win: a top-level "title" beats "monitor.title".
  const byDepth = [...leaves].sort((a, b) => depthOf(a) - depthOf(b));
  const first = (set: Set<string>, accept: (leaf: Leaf) => boolean = () => true) =>
    byDepth.find(leaf => !used.has(leaf) && set.has(normKey(leaf.key)) && accept(leaf));
  const isText = (leaf: Leaf) => typeof leaf.value === 'string' && leaf.value.trim() !== '';

  const title = first(
    TITLE,
    leaf => isText(leaf) && (normKey(leaf.key) !== 'name' || depthOf(leaf) === 1)
  );
  if (title) {
    out.title = clip(String(title.value));
    take(title);
  }
  const message = first(MESSAGE, leaf => isText(leaf) && String(leaf.value) !== out.title);
  if (message) {
    out.message = String(message.value).slice(0, 4000);
    take(message);
  }
  for (const leaf of byDepth) {
    if (used.has(leaf) || !STATUS.has(normKey(leaf.key)) || typeof leaf.value !== 'string')
      continue;
    const status = normalizeStatus(leaf.value);
    if (status) {
      out.status = status;
      take(leaf);
      break;
    }
  }
  const severity = first(SEVERITY, leaf => isText(leaf) || typeof leaf.value === 'number');
  if (severity) {
    out.severity = String(severity.value).trim().toLowerCase();
    take(severity);
  }
  const query = first(QUERY, leaf => isText(leaf) && String(leaf.value).length > 3);
  if (query) {
    out.query = {
      language: queryLanguage(normKey(query.key), String(query.value)),
      text: clip(String(query.value)),
    };
    take(query);
  }
  const condition = first(CONDITION, isText);
  if (condition) {
    out.condition = clip(String(condition.value));
    take(condition);
  }
  const value = first(VALUE, leaf => typeof leaf.value !== 'boolean');
  const threshold = first(THRESHOLD, leaf => typeof leaf.value !== 'boolean');
  if (value) {
    out.measured = {
      value: String(value.value),
      threshold: threshold ? String(threshold.value) : null,
    };
    take(value);
    if (threshold) take(threshold);
  }

  const seenWhere = new Set<string>();
  const seenLinks = new Set<string>();
  for (const leaf of byDepth) {
    if (used.has(leaf)) continue;
    const k = normKey(leaf.key);
    const s = String(leaf.value);
    if (typeof leaf.value === 'string' && isHttpUrl(s)) {
      const lk = leaf.key.toLowerCase();
      if (IMAGE_KEY.test(lk) || /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(s)) {
        if (!out.images.includes(s)) out.images.push(s);
      } else if (!seenLinks.has(s)) {
        seenLinks.add(s);
        out.links.push({
          label: LINK_LABEL.find(([re]) => re.test(k))?.[1] ?? humanKey(leaf.key),
          url: s,
        });
      }
      take(leaf);
      continue;
    }
    if (
      // eslint-disable-next-line security/detect-object-injection -- k is matched against a fixed lookup of known keys
      WHERE[k] &&
      (typeof leaf.value === 'string' || typeof leaf.value === 'number') &&
      s.trim()
    ) {
      // eslint-disable-next-line security/detect-object-injection -- k is matched against a fixed lookup of known keys
      const label = WHERE[k];
      if (!seenWhere.has(label)) {
        seenWhere.add(label);
        out.where.push({ label, value: clip(s) });
      }
      take(leaf);
      continue;
    }
    if (TIME_KEY.test(leaf.key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase())) {
      const at = asTime(leaf.value);
      if (at) {
        const label = timeLabel(leaf.key);
        if (!out.when.some(t => t.label === label)) out.when.push({ label, at });
        take(leaf);
        continue;
      }
    }
    // Tag lists: ["env:prod", "team:payments"] or a "tags"/"labels" array of strings.
    const parent = normKey(leaf.path[leaf.path.length - 2] ?? '');
    if (/^(tags|labels|taglist|commonlabels)$/.test(parent) && typeof leaf.value !== 'boolean') {
      // Arrays hold "key:value" strings already; objects become "key:value".
      const tag = /^\d+$/.test(leaf.key) ? s : `${leaf.key}:${s}`;
      if (out.tags.length < 40 && !out.tags.includes(tag)) out.tags.push(clip(tag));
      take(leaf);
    }
  }

  for (const leaf of leaves) {
    if (used.has(leaf) || out.fields.length >= MAX_LEFTOVER) continue;
    const s = String(leaf.value);
    if (s.trim() === '') continue;
    out.fields.push({ label: leaf.path.map(humanKey).join(' › '), value: clip(s) });
  }
  return out;
}

function queryLanguage(key: string, text: string): string | null {
  if (
    key === 'promql' ||
    (/\b(rate|sum|avg|irate|histogram_quantile)\s*\(/.test(text) && /\[\d+[smhd]\]/.test(text))
  )
    return 'PromQL';
  if (key === 'nrql' || /^\s*select\b[\s\S]*\bfrom\b[\s\S]*\bsince\b/i.test(text)) return 'NRQL';
  if (key === 'sql' || /^\s*(select|with)\b[\s\S]*\bfrom\b/i.test(text)) return 'SQL';
  if (key === 'logql' || /\{[^}]*=~?"[^"]*"[^}]*\}\s*\|/.test(text)) return 'LogQL';
  if (key === 'spl' || /^\s*(search|index=)/i.test(text)) return 'SPL';
  if (key === 'kql' || /\|\s*(where|summarize|project)\b/.test(text)) return 'KQL';
  if (/^(avg|sum|min|max|count)\(last_\d+[mhd]\):/.test(text)) return 'Datadog';
  return null;
}

export type { ReadableField, ReadableLink, ReadableTime };

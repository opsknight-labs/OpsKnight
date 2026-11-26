import type {
  PayloadStatus,
  ReadableField,
  ReadableLink,
  ReadableTime,
  SourceReader,
} from '../types';
import { asTime, isHttpUrl, normalizeStatus, normKey } from '../generic';
import { at, has, isObj, labelTags, str, type Obj } from './helpers';

/**
 * Readers for error trackers, incident tools, infra and uptime monitors, CI/CD and platform events. Each detects
 * its payloads by shape (the keys that tool always sends), reads only what that tool documents, and leaves the
 * rest to the generic reader.
 */

type Pair = [string, string | null | undefined];

const present = (pairs: Pair[]) => pairs.filter((p): p is [string, string] => Boolean(p[1]));

const fields = (...pairs: Pair[]): ReadableField[] =>
  present(pairs).map(([label, value]) => ({ label, value }));

const links = (...pairs: Pair[]): ReadableLink[] =>
  present(pairs)
    .filter(([, url]) => isHttpUrl(url))
    .map(([label, url]) => ({ label, url }));

/** ISO, epoch and the date strings tools print ("Mon Jan 15 10:15:32 UTC 2024") → ISO. */
function iso(value: string): string | null {
  const known = asTime(value);
  if (known) return known;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const times = (...pairs: Pair[]): ReadableTime[] =>
  present(pairs).flatMap(([label, value]) => {
    const when = iso(value);
    return when ? [{ label, at: when }] : [];
  });

const lower = (value: string | null | undefined) => value?.toLowerCase() ?? null;

/** A tool's own status word → our status; falls back to the shared vocabulary. */
function statusFrom(
  value: string | null | undefined,
  map: Record<string, PayloadStatus> = {}
): PayloadStatus | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  // eslint-disable-next-line security/detect-object-injection -- looks up a status or level in a fixed table, with a fallback
  return map[v] ?? normalizeStatus(v);
}

const oneOf = (value: unknown, ...words: string[]) =>
  typeof value === 'string' && words.includes(value.toLowerCase());

/** Tags as [["k","v"]], [{key|name|tag, value}], ["k:v"] or {k: v}. */
function pairTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return labelTags(tags);
  return tags.flatMap(tag => {
    if (typeof tag === 'string') return tag.trim() ? [tag.trim()] : [];
    if (Array.isArray(tag) && tag.length === 2) return [`${tag[0]}:${tag[1]}`];
    const key = str(tag, 'key', 'name', 'tag');
    if (!key) return [];
    const value = str(tag, 'value');
    return [value ? `${key}:${value}` : key];
  });
}

const splitTags = (value: string | null, separator: RegExp = /,/) =>
  value
    ? value
        .split(separator)
        .map(t => t.trim())
        .filter(Boolean)
    : [];

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null);

/** CI / deploy outcomes: a failure fires, a success resolves, anything in flight is informational. */
const CI_STATUS: Record<string, PayloadStatus> = {
  failure: 'firing',
  failed: 'firing',
  error: 'firing',
  errored: 'firing',
  timed_out: 'firing',
  startup_failure: 'firing',
  action_required: 'firing',
  unstable: 'firing',
  success: 'resolved',
  succeeded: 'resolved',
  successful: 'resolved',
  ready: 'resolved',
  promoted: 'resolved',
  fixed: 'resolved',
  cancelled: 'info',
  canceled: 'info',
  aborted: 'info',
  stopped: 'info',
  skipped: 'info',
  neutral: 'info',
  stale: 'info',
  pending: 'info',
  queued: 'info',
  waiting: 'info',
  requested: 'info',
  in_progress: 'info',
  inprogress: 'info',
  running: 'info',
  created: 'info',
  manual: 'info',
  started: 'info',
  inactive: 'info',
  not_built: 'info',
};

const CI_WORD: Record<string, string> = {
  failure: 'failed',
  failed: 'failed',
  error: 'errored',
  success: 'succeeded',
  successful: 'succeeded',
  timed_out: 'timed out',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  in_progress: 'in progress',
  inprogress: 'in progress',
};
const ciWord = (status: string | null) =>
  status ? (CI_WORD[status.toLowerCase()] ?? status.toLowerCase()) : null;

// ───────────────────────────── Error tracking / APM ─────────────────────────────

const SENTRY_ACTION: Record<string, PayloadStatus> = {
  triggered: 'firing',
  created: 'firing',
  unresolved: 'firing',
  reopened: 'firing',
  unassigned: 'firing',
  critical: 'firing',
  warning: 'firing',
  resolved: 'resolved',
  ignored: 'resolved',
  archived: 'resolved',
  assigned: 'acknowledged',
};

/** Sentry: integration-platform issue alerts, metric alerts and issue webhooks, and the legacy plugin webhook. */
export const sentry: SourceReader = {
  id: 'sentry',
  name: 'Sentry',
  detect: data =>
    isObj(data) &&
    (has(data, 'data.metric_alert') ||
      has(data, 'data.event.issue_id') ||
      has(data, 'data.event.issue_url') ||
      has(data, 'data.issue.shortId') ||
      has(data, 'data.error.event_id') ||
      has(data, 'issue.shortId', 'issue.permalink') ||
      (has(data, 'project_slug', 'culprit') && (has(data, 'url') || has(data, 'event')))),
  read: data => {
    const action = lower(str(data, 'action'));
    const metric = at(data, 'data.metric_alert');
    if (isObj(metric)) {
      const rule = at(metric, 'alert_rule');
      const aggregate = str(rule, 'aggregate');
      const filter = str(rule, 'query');
      return {
        title: str(data, 'data.description_title') ?? str(metric, 'title') ?? str(rule, 'name'),
        status: statusFrom(action, SENTRY_ACTION),
        severity: oneOf(action, 'critical', 'warning') ? action : null,
        condition: str(rule, 'name'),
        query: aggregate
          ? { language: 'Sentry', text: filter ? `${aggregate} where ${filter}` : aggregate }
          : null,
        message: str(data, 'data.description_text'),
        where: fields(['Env', str(rule, 'environment')], ['Project', str(rule, 'projects.0')]),
        links: links(['Open in Sentry', str(data, 'data.web_url')]),
        when: times(
          ['Started', str(metric, 'date_started')],
          ['Detected', str(metric, 'date_detected')],
          ['Resolved', str(metric, 'date_closed')]
        ),
      };
    }
    const event = at(data, 'data.event') ?? at(data, 'data.error') ?? at(data, 'event');
    const issue = at(data, 'data.issue') ?? at(data, 'issue');
    const tags = pairTags(at(event, 'tags'));
    const tag = (key: string) =>
      tags.find(t => t.startsWith(`${key}:`))?.slice(key.length + 1) ?? null;
    const count = str(issue, 'count');
    const users = str(issue, 'userCount');
    return {
      title: str(event, 'title') ?? str(issue, 'title') ?? str(data, 'message'),
      status: action ? statusFrom(action, SENTRY_ACTION) : 'firing',
      severity: lower(str(event, 'level') ?? str(issue, 'level') ?? str(data, 'level')),
      condition: str(data, 'data.triggered_rule', 'triggering_rules.0'),
      measured: count
        ? { value: `${count} events${users ? `, ${users} users` : ''}`, threshold: null }
        : null,
      message:
        str(event, 'metadata.value', 'message', 'logentry.formatted') ??
        str(issue, 'metadata.value'),
      tags,
      where: fields(
        [
          'Project',
          str(issue, 'project.name', 'project.slug') ??
            str(data, 'project_name', 'project_slug', 'project'),
        ],
        ['Env', str(event, 'environment') ?? tag('environment')],
        ['Release', str(event, 'release') ?? tag('release')],
        ['Culprit', str(event, 'culprit') ?? str(issue, 'culprit') ?? str(data, 'culprit')]
      ),
      links: links([
        'Open in Sentry',
        str(event, 'web_url') ?? str(issue, 'permalink', 'web_url') ?? str(data, 'url'),
      ]),
      when: times(
        ['Started', str(issue, 'firstSeen')],
        ['Last update', str(issue, 'lastSeen')],
        ['Occurred', str(event, 'datetime', 'timestamp')]
      ),
    };
  },
};

const BUGSNAG_STATUS: Record<string, PayloadStatus> = {
  open: 'firing',
  fixed: 'resolved',
  ignored: 'resolved',
  snoozed: 'acknowledged',
};

/** Bugsnag error notifications: { account, project, trigger: { type, message }, error: {…} }. */
export const bugsnag: SourceReader = {
  id: 'bugsnag',
  name: 'Bugsnag',
  detect: data =>
    isObj(data) &&
    typeof at(data, 'trigger.type') === 'string' &&
    has(data, 'project') &&
    (has(data, 'error.exceptionClass') || has(data, 'error.errorId') || has(data, 'release')),
  read: data => {
    const error = at(data, 'error');
    return {
      title:
        [str(error, 'exceptionClass'), str(error, 'message')].filter(Boolean).join(': ') ||
        str(data, 'trigger.message'),
      status:
        statusFrom(str(error, 'status'), BUGSNAG_STATUS) ?? (isObj(error) ? 'firing' : 'info'),
      severity: lower(str(error, 'severity')),
      condition: str(data, 'trigger.message'),
      message: str(error, 'message'),
      where: fields(
        ['Project', str(data, 'project.name')],
        ['Env', str(error, 'app.releaseStage', 'releaseStage')],
        ['Context', str(error, 'context')],
        ['Host', str(error, 'device.hostname', 'hostname')],
        ['Release', str(error, 'app.version')]
      ),
      links: links(
        ['Open in Bugsnag', str(error, 'url')],
        ['Request', str(error, 'requestUrl')],
        ['Project', str(data, 'project.url')]
      ),
      when: times(
        ['Started', str(error, 'firstReceived')],
        ['Last update', str(error, 'receivedAt')]
      ),
    };
  },
};

const ROLLBAR_LEVEL: Record<string, string> = {
  '10': 'debug',
  '20': 'info',
  '30': 'warning',
  '40': 'error',
  '50': 'critical',
};
const ROLLBAR_EVENT: Record<string, string> = {
  new_item: 'New item',
  occurrence: 'New occurrence',
  exp_repeat_item: 'Repeated occurrences',
  item_velocity: 'Occurrence rate above threshold',
  reactivated_item: 'Reactivated item',
  reopened_item: 'Reopened item',
  resolved_item: 'Resolved item',
  deploy: 'Deploy',
};

/** Rollbar webhooks: { event_name, data: { item, url, occurrence } }. */
export const rollbar: SourceReader = {
  id: 'rollbar',
  name: 'Rollbar',
  detect: data =>
    isObj(data) &&
    typeof at(data, 'event_name') === 'string' &&
    (isObj(at(data, 'data.item')) || isObj(at(data, 'data.deploy'))),
  read: data => {
    const event = lower(str(data, 'event_name'));
    const item = at(data, 'data.item');
    const level = str(item, 'level');
    const total = str(item, 'total_occurrences');
    return {
      title: str(item, 'title') ?? str(data, 'data.deploy.comment'),
      status:
        event === 'resolved_item' || oneOf(at(item, 'status'), 'resolved')
          ? 'resolved'
          : event === 'deploy'
            ? 'info'
            : 'firing',
      // eslint-disable-next-line security/detect-object-injection -- looks up a status or level in a fixed table, with a fallback
      severity: level ? (ROLLBAR_LEVEL[level] ?? level.toLowerCase()) : null,
      condition:
        event === 'exp_repeat_item' && str(data, 'data.occurrences')
          ? `${str(data, 'data.occurrences')} occurrences`
          : (ROLLBAR_EVENT[event ?? ''] ?? null),
      measured: total ? { value: `${total} occurrences`, threshold: null } : null,
      message: str(
        item,
        'last_occurrence.body.trace.exception.message',
        'last_occurrence.body.message.body'
      ),
      where: fields(
        ['Env', str(item, 'environment') ?? str(data, 'data.deploy.environment')],
        ['Host', str(item, 'last_occurrence.server.host')],
        ['Framework', str(item, 'framework')]
      ),
      links: links(['Open in Rollbar', str(data, 'data.url')]),
      when: times(
        ['Started', str(item, 'first_occurrence_timestamp')],
        ['Last update', str(item, 'last_occurrence_timestamp')]
      ),
    };
  },
};

/** Raygun error notifications: { event: "error_notification" | "error_activity", eventType, error, application }. */
export const raygun: SourceReader = {
  id: 'raygun',
  name: 'Raygun',
  detect: data =>
    isObj(data) &&
    (oneOf(at(data, 'event'), 'error_notification', 'error_activity') ||
      (typeof at(data, 'eventType') === 'string' &&
        has(data, 'error.url') &&
        has(data, 'application'))),
  read: data => {
    const error = at(data, 'error');
    const total = str(error, 'totalOccurrences');
    const users = str(error, 'usersAffected');
    return {
      title: str(error, 'message'),
      status:
        statusFrom(str(error, 'status'), { active: 'firing', ignored: 'resolved' }) ?? 'firing',
      condition: str(data, 'eventType'),
      measured: total
        ? { value: `${total} occurrences${users ? `, ${users} users` : ''}`, threshold: null }
        : null,
      where: fields(['Application', str(data, 'application.name')]),
      links: links(
        ['Open in Raygun', str(error, 'url')],
        ['Application', str(data, 'application.url')]
      ),
      when: times(
        ['Started', str(error, 'firstOccurredOn')],
        ['Last update', str(error, 'lastOccurredOn')]
      ),
    };
  },
};

// ───────────────────────────── Incident tools ─────────────────────────────

const PD_ACTION: Record<string, PayloadStatus> = {
  trigger: 'firing',
  triggered: 'firing',
  reopened: 'firing',
  unacknowledged: 'firing',
  escalated: 'firing',
  acknowledge: 'acknowledged',
  acknowledged: 'acknowledged',
  resolve: 'resolved',
  resolved: 'resolved',
};

/** PagerDuty: Webhooks v3 ({ event: { event_type, data } }) and the Events API v2 / v1 bodies forwarded to us. */
export const pagerduty: SourceReader = {
  id: 'pagerduty',
  name: 'PagerDuty',
  detect: data =>
    isObj(data) &&
    ((typeof at(data, 'event.event_type') === 'string' &&
      has(data, 'event.resource_type') &&
      isObj(at(data, 'event.data'))) ||
      (has(data, 'routing_key') && has(data, 'event_action') && isObj(at(data, 'payload'))) ||
      (has(data, 'event_action', 'payload.summary', 'payload.severity', 'payload.source') &&
        !has(data, 'routing_key')) ||
      (has(data, 'service_key', 'event_type') &&
        oneOf(at(data, 'event_type'), 'trigger', 'acknowledge', 'resolve'))),
  read: data => {
    const v3 = at(data, 'event.data');
    if (isObj(at(data, 'event')) && isObj(v3)) {
      const eventType = str(data, 'event.event_type') ?? '';
      return {
        title: str(v3, 'title', 'summary'),
        status:
          statusFrom(eventType.split('.').pop(), PD_ACTION) ??
          statusFrom(str(v3, 'status'), PD_ACTION),
        severity: lower(str(v3, 'priority.summary') ?? str(v3, 'urgency')),
        condition: eventType || null,
        message: str(v3, 'body.details', 'description'),
        where: fields(
          ['Service', str(v3, 'service.summary')],
          ['Escalation policy', str(v3, 'escalation_policy.summary')],
          ['Assignee', str(v3, 'assignees.0.summary')],
          ['Team', str(v3, 'teams.0.summary')]
        ),
        links: links(
          ['Open in PagerDuty', str(v3, 'html_url')],
          ['Service', str(v3, 'service.html_url')],
          ['Conference bridge', str(v3, 'conference_bridge.conference_url')]
        ),
        when: times(
          ['Started', str(v3, 'created_at')],
          ['Last update', str(data, 'event.occurred_at')]
        ),
      };
    }
    if (has(data, 'service_key')) {
      return {
        title: str(data, 'description'),
        status: statusFrom(str(data, 'event_type'), PD_ACTION),
        links: links(['Open in source', str(data, 'client_url')]),
      };
    }
    const payload = at(data, 'payload');
    const pdLinks = Array.isArray(at(data, 'links')) ? (at(data, 'links') as unknown[]) : [];
    const pdImages = Array.isArray(at(data, 'images')) ? (at(data, 'images') as unknown[]) : [];
    return {
      title: str(payload, 'summary'),
      status: statusFrom(str(data, 'event_action'), PD_ACTION),
      severity: lower(str(payload, 'severity')),
      condition: str(payload, 'class'),
      where: fields(
        ['Source', str(payload, 'source')],
        ['Component', str(payload, 'component')],
        ['Group', str(payload, 'group')]
      ),
      links: [
        ...links([str(data, 'client') ?? 'Open in source', str(data, 'client_url')]),
        ...links(...pdLinks.map((l): Pair => [str(l, 'text') ?? 'Link', str(l, 'href')])),
      ],
      images: pdImages.map(i => str(i, 'src')).filter((u): u is string => Boolean(u)),
      when: times(['Started', str(payload, 'timestamp')]),
    };
  },
};

const OPSGENIE_ACTION: Record<string, PayloadStatus> = {
  create: 'firing',
  unacknowledge: 'firing',
  escalate: 'firing',
  close: 'resolved',
  delete: 'resolved',
  acknowledge: 'acknowledged',
};

/** Opsgenie outgoing webhook: { action, alert: { alertId, message, … }, source, integrationName }. */
export const opsgenie: SourceReader = {
  id: 'opsgenie',
  name: 'Opsgenie',
  detect: data =>
    isObj(data) &&
    has(data, 'action', 'alert.alertId') &&
    (has(data, 'integrationName') || has(data, 'integrationType') || has(data, 'alert.tinyId')),
  read: data => {
    const alert = at(data, 'alert');
    return {
      title: str(alert, 'message'),
      status:
        statusFrom(str(data, 'action'), OPSGENIE_ACTION) ??
        (at(alert, 'acknowledged') === true ? 'acknowledged' : statusFrom(str(alert, 'status'))),
      severity: lower(str(alert, 'priority')),
      message: str(alert, 'description'),
      tags: pairTags(at(alert, 'tags')),
      where: fields(
        ['Entity', str(alert, 'entity')],
        ['Source', str(alert, 'source')],
        ['Team', str(alert, 'team', 'teams.0')]
      ),
      when: times(['Started', str(alert, 'createdAt')], ['Last update', str(alert, 'updatedAt')]),
    };
  },
};

const VO_MESSAGE: Record<string, PayloadStatus> = {
  critical: 'firing',
  warning: 'firing',
  acknowledgement: 'acknowledged',
  recovery: 'resolved',
  ok: 'resolved',
  info: 'info',
};

/** Splunk On-Call (VictorOps) REST alert: { message_type, entity_id, state_message, vo_annotate.* }. */
export const splunkOnCall: SourceReader = {
  id: 'splunk-oncall',
  name: 'Splunk On-Call',
  detect: data =>
    isObj(data) &&
    oneOf(at(data, 'message_type'), ...Object.keys(VO_MESSAGE)) &&
    (has(data, 'entity_id') || has(data, 'entity_display_name') || has(data, 'state_message')),
  read: data => {
    const type = lower(str(data, 'message_type'));
    const annotations = Object.entries(data).filter(([k]) => k.startsWith('vo_annotate.'));
    const kind = (k: string) => k.split('.')[1];
    const label = (k: string) => k.split('.').slice(2).join('.') || 'Link';
    return {
      title: str(data, 'entity_display_name', 'state_message', 'entity_id'),
      status: statusFrom(type, VO_MESSAGE),
      severity: oneOf(type, 'critical', 'warning') ? type : null,
      message: str(data, 'state_message'),
      where: fields(
        ['Entity', str(data, 'entity_id')],
        ['Host', str(data, 'host_name')],
        ['Monitoring tool', str(data, 'monitoring_tool')]
      ),
      links: links(
        ...annotations
          .filter(([k]) => kind(k) === 'u')
          .map(([k, v]): Pair => [label(k), typeof v === 'string' ? v : null])
      ),
      images: annotations
        .filter(([k, v]) => kind(k) === 'i' && typeof v === 'string')
        .map(([, v]) => v as string),
      when: times(['Started', str(data, 'state_start_time')]),
    };
  },
};

// ───────────────────────────── Infra monitoring ─────────────────────────────

const ZABBIX_MARKERS = [
  'trigger_id',
  'triggerId',
  'trigger_name',
  'triggerName',
  'event_nseverity',
  'event_value',
  'eventValue',
  'event_opdata',
  'eventOpdata',
  'item_key',
  'itemKey',
  'event_update_status',
];

/** Zabbix: the JSON the common webhook media types send, and the classic "Problem: …" message as Key: value text. */
export const zabbix: SourceReader = {
  id: 'zabbix',
  name: 'Zabbix',
  detect: data =>
    isObj(data) &&
    ((has(data, 'Problem name') &&
      (has(data, 'Host') || has(data, 'Severity') || has(data, 'Original problem ID'))) ||
      ((has(data, 'event_id') ||
        has(data, 'eventId') ||
        has(data, 'event_name') ||
        has(data, 'eventName')) &&
        ZABBIX_MARKERS.some(key => has(data, key)))),
  read: data => {
    if (has(data, 'Problem name')) {
      // "Problem duration" and a "Resolved …" subject only appear in the recovery message.
      const resolved =
        has(data, 'Problem duration') || Object.keys(data).some(k => /^resolved\b/i.test(k));
      return {
        title: str(data, 'Problem name', 'Problem'),
        status: resolved ? 'resolved' : 'firing',
        severity: lower(str(data, 'Severity')),
        measured: str(data, 'Operational data')
          ? { value: str(data, 'Operational data')!, threshold: null }
          : null,
        where: fields(['Host', str(data, 'Host')]),
      };
    }
    const value = str(data, 'event_value', 'eventValue');
    const update = lower(str(data, 'event_update_action', 'eventUpdateAction'));
    const itemValue = str(data, 'item_value', 'itemValue');
    const itemName = str(data, 'item_name', 'itemName');
    const title = str(data, 'event_name', 'eventName', 'trigger_name', 'triggerName', 'subject');
    const trigger = str(data, 'trigger_name', 'triggerName');
    const date = (d: string | null, t: string | null) =>
      d && t ? `${d.replace(/\./g, '-')} ${t}` : null;
    const tags = at(data, 'event_tags') ?? at(data, 'eventTags');
    return {
      title,
      status:
        update && /acknowledged/.test(update) && !/unacknowledged/.test(update)
          ? 'acknowledged'
          : value === '1'
            ? 'firing'
            : value === '0'
              ? 'resolved'
              : statusFrom(str(data, 'event_status', 'eventStatus', 'trigger_status', 'status')),
      severity: lower(str(data, 'event_severity', 'eventSeverity', 'severity')),
      condition:
        str(data, 'trigger_expression', 'triggerExpression') ??
        (trigger && trigger !== title ? trigger : null),
      measured: itemValue
        ? { value: itemName ? `${itemName}: ${itemValue}` : itemValue, threshold: null }
        : str(data, 'event_opdata', 'eventOpdata')
          ? { value: str(data, 'event_opdata', 'eventOpdata')!, threshold: null }
          : null,
      message: str(data, 'alert_message', 'message', 'trigger_description', 'triggerDescription'),
      tags: typeof tags === 'string' ? splitTags(tags) : pairTags(tags),
      where: fields(
        ['Host', str(data, 'host_name', 'hostName', 'host')],
        ['IP', str(data, 'host_ip', 'hostIp')],
        ['Item', str(data, 'item_key', 'itemKey')]
      ),
      links: links(
        ['Open in Zabbix', str(data, 'event_url', 'eventUrl', 'trigger_url', 'triggerUrl')],
        ['Zabbix', str(data, 'zabbix_url', 'zabbixUrl')]
      ),
      when: times(
        [
          'Started',
          date(str(data, 'event_date', 'eventDate'), str(data, 'event_time', 'eventTime')),
        ],
        ['Resolved', date(str(data, 'event_recovery_date'), str(data, 'event_recovery_time'))]
      ),
    };
  },
};

/** Nagios/Icinga macros by normalised name, any NAGIOS_/ICINGA_ env-var prefix dropped: "NAGIOS_SERVICEDESC", "service_desc" → "servicedesc". */
function macros(data: Obj): (...names: string[]) => string | null {
  const index = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    const name = normKey(key).replace(/^(nagios|icinga)(?=[a-z])/, '');
    const text =
      typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (text && !index.has(name)) index.set(name, text);
  }
  return (...names) => names.map(n => index.get(n)).find(Boolean) ?? null;
}

const NAGIOS_TYPE: Record<string, PayloadStatus> = {
  problem: 'firing',
  flappingstart: 'firing',
  recovery: 'resolved',
  flappingstop: 'resolved',
  acknowledgement: 'acknowledged',
  flappingdisabled: 'info',
  downtimestart: 'info',
  downtimeend: 'info',
  downtimecancelled: 'info',
  downtimeremoved: 'info',
  custom: 'info',
};
const NAGIOS_STATE: Record<string, PayloadStatus> = {
  ok: 'resolved',
  up: 'resolved',
  warning: 'firing',
  critical: 'firing',
  unknown: 'firing',
  down: 'firing',
  unreachable: 'firing',
};

/** "time=0.52s;0.3;1.0;0" → value "time = 0.52s", threshold "warn 0.3, crit 1.0". */
function perfMeasured(perf: string | null) {
  const m = perf?.match(/^'?([^=']+)'?=([^;\s]+);?([^;\s]*);?([^;\s]*)/);
  if (!m) return null;
  const threshold = [m[3] && `warn ${m[3]}`, m[4] && `crit ${m[4]}`].filter(Boolean).join(', ');
  return { value: `${m[1]} = ${m[2]}`, threshold: threshold || null };
}

/** The Nagios notification vocabulary (macros, env vars, or the stock e-mail text), shared with Icinga. */
function readNagiosLike(data: Obj): ReturnType<SourceReader['read']> {
  const m = macros(data);
  const host = m('hostname', 'host', 'hostdisplayname', 'hostalias');
  const service = m('servicedesc', 'servicedisplayname', 'servicename', 'service');
  const state = service
    ? m('servicestate', 'state', 'hoststate')
    : m('hoststate', 'state', 'servicestate');
  const output = service
    ? m('serviceoutput', 'output', 'info', 'hostoutput')
    : m('hostoutput', 'output', 'info');
  const long = m(service ? 'longserviceoutput' : 'longhostoutput');
  const comment = m('notificationcomment', 'serviceackcomment', 'hostackcomment', 'comment');
  const author = m('notificationauthor', 'serviceackauthor', 'hostackauthor', 'author');
  return {
    title: host && state ? `${service ? `${service} on ${host}` : host} is ${state}` : null,
    status: statusFrom(m('notificationtype'), NAGIOS_TYPE) ?? statusFrom(state, NAGIOS_STATE),
    severity: lower(state),
    condition: m('servicecheckcommand', 'hostcheckcommand', 'checkcommand'),
    measured: perfMeasured(m('serviceperfdata', 'hostperfdata', 'perfdata')),
    message:
      [output, long, comment && `${author ? `${author}: ` : ''}${comment}`]
        .filter(Boolean)
        .join('\n') || null,
    where: fields(
      ['Host', host],
      ['Service', service],
      ['Address', m('hostaddress', 'address', 'ipv4', 'hostaddress6', 'ipv6')],
      ['Host group', m('hostgroupname')]
    ),
    links: links(
      ['Notes', m('servicenotesurl', 'hostnotesurl', 'notesurl')],
      ['Action', m('serviceactionurl', 'hostactionurl', 'actionurl')]
    ),
    when: times(['Notified', m('timet', 'longdatetime', 'datetime', 'when', 'timestamp')]),
  };
}

/** Icinga 2: notification JSON (host_name / service_name / notification_type) and API event-stream objects. */
export const icinga: SourceReader = {
  id: 'icinga',
  name: 'Icinga 2',
  detect: data => {
    if (!isObj(data)) return false;
    if (
      oneOf(at(data, 'type'), 'notification', 'statechange', 'checkresult') &&
      typeof at(data, 'host') === 'string' &&
      (isObj(at(data, 'check_result')) || has(data, 'notification_type'))
    )
      return true;
    const keys = Object.keys(data).map(normKey);
    const m = macros(data);
    return (
      (keys.some(k => /^icinga[a-z]/.test(k)) ||
        ['servicename', 'hostdisplayname', 'servicedisplayname', 'checkcommand'].some(k =>
          keys.includes(k)
        )) &&
      Boolean(m('hostname', 'hostdisplayname', 'host')) &&
      Boolean(m('notificationtype', 'servicestate', 'hoststate', 'state'))
    );
  },
  read: data => {
    const result = at(data, 'check_result');
    const code = at(data, 'state') ?? at(result, 'state');
    const states = str(data, 'service') ? ['OK', 'WARNING', 'CRITICAL', 'UNKNOWN'] : ['UP', 'DOWN'];
    const perf = at(result, 'performance_data');
    return readNagiosLike({
      ...data,
      // eslint-disable-next-line security/detect-object-injection -- looks up a status or level in a fixed table, with a fallback
      state: typeof code === 'number' ? (states[code] ?? String(code)) : at(data, 'state'),
      output: at(data, 'output') ?? str(result, 'output'),
      perfdata: Array.isArray(perf) ? perf.join(' ') : at(data, 'perfdata'),
      comment: at(data, 'comment') ?? at(data, 'text'),
    });
  },
};

/** Nagios Core / XI notifications: macros (HOSTNAME, SERVICEDESC, …) as JSON, env vars or the stock e-mail text. */
export const nagios: SourceReader = {
  id: 'nagios',
  name: 'Nagios',
  detect: data => {
    if (!isObj(data) || icinga.detect(data)) return false;
    const m = macros(data);
    const host = m('hostname', 'host');
    return Boolean(
      host &&
      ((m('notificationtype') && m('servicestate', 'hoststate', 'state')) ||
        (m('servicedesc') && m('servicestate')) ||
        (m('hoststate') && m('hostoutput')))
    );
  },
  read: readNagiosLike,
};

/** Netdata Cloud webhook: { message, alert, info, chart, context, space, severity, alert_url, … }. */
export const netdata: SourceReader = {
  id: 'netdata',
  name: 'Netdata',
  detect: data =>
    isObj(data) &&
    has(data, 'alert', 'chart', 'context') &&
    (has(data, 'alert_url') ||
      has(data, 'additional_active_critical_alerts') ||
      has(data, 'space')),
  read: data => ({
    title: str(data, 'message', 'alert'),
    status: statusFrom(str(data, 'severity'), { warning: 'firing', clear: 'resolved' }),
    severity: lower(str(data, 'severity')),
    condition: str(data, 'alert'),
    message: str(data, 'info'),
    where: fields(
      ['Node', str(data, 'node', 'hostname')],
      ['Chart', str(data, 'chart')],
      ['Context', str(data, 'context')],
      ['Family', str(data, 'family')],
      ['Space', str(data, 'space')],
      ['Class', str(data, 'class')]
    ),
    links: links(['Open in Netdata', str(data, 'alert_url')]),
    when: times(['Started', str(data, 'date')]),
  }),
};

// ───────────────────────────── Uptime ─────────────────────────────

/** Pingdom state-change webhook: { check_id, check_name, previous_state, current_state, importance_level, … }. */
export const pingdom: SourceReader = {
  id: 'pingdom',
  name: 'Pingdom',
  detect: data =>
    isObj(data) &&
    has(data, 'check_id', 'current_state') &&
    (has(data, 'previous_state') || has(data, 'check_type') || has(data, 'importance_level')),
  read: data => {
    const name = str(data, 'check_name');
    const state = str(data, 'current_state');
    return {
      title: name && state ? `${name} is ${state.toLowerCase()}` : name,
      status: statusFrom(state, { success: 'resolved', failing: 'firing' }),
      severity: lower(str(data, 'importance_level')),
      condition: str(data, 'check_type') ? `${str(data, 'check_type')} check` : null,
      message: str(data, 'long_description', 'description'),
      tags: pairTags(at(data, 'tags')),
      where: fields(
        ['Host', str(data, 'check_params.hostname')],
        ['Probe', str(data, 'first_probe.location')]
      ),
      links: links(['Checked URL', str(data, 'check_params.full_url')]),
      when: times(['Changed', str(data, 'state_changed_utc_time', 'state_changed_timestamp')]),
    };
  },
};

/** UptimeRobot alert-contact webhook (*monitorID*, *alertType*, … variables). */
export const uptimerobot: SourceReader = {
  id: 'uptimerobot',
  name: 'UptimeRobot',
  detect: data =>
    isObj(data) &&
    (has(data, 'monitorID') || has(data, 'monitorFriendlyName')) &&
    (has(data, 'alertType') || has(data, 'alertTypeFriendlyName')),
  read: data => {
    const name = str(data, 'monitorFriendlyName');
    const friendly = str(data, 'alertTypeFriendlyName');
    const type = str(data, 'alertType');
    return {
      title: name && friendly ? `${name} is ${friendly.toLowerCase()}` : name,
      status: type === '1' ? 'firing' : type === '2' ? 'resolved' : statusFrom(friendly),
      message: str(data, 'alertDetails'),
      links: links(['Checked URL', str(data, 'monitorURL')]),
      when: times(['Changed', str(data, 'alertDateTime')]),
    };
  },
};

const KUMA_STATUS: Array<[string, PayloadStatus]> = [
  ['down', 'firing'],
  ['up', 'resolved'],
  ['pending', 'info'],
  ['maintenance', 'info'],
];

/** Uptime Kuma webhook: { heartbeat: { status, msg, time, ping }, monitor: { name, url, … }, msg }. */
export const uptimeKuma: SourceReader = {
  id: 'uptime-kuma',
  name: 'Uptime Kuma',
  detect: data =>
    isObj(data) &&
    'heartbeat' in data &&
    'monitor' in data &&
    (typeof at(data, 'msg') === 'string' || has(data, 'heartbeat.monitorID')),
  read: data => {
    const code = at(data, 'heartbeat.status');
    const [word, status] =
      // eslint-disable-next-line security/detect-object-injection -- looks up a status or level in a fixed table, with a fallback
      typeof code === 'number' ? (KUMA_STATUS[code] ?? [null, null]) : [null, null];
    const name = str(data, 'monitor.name');
    const time = str(data, 'heartbeat.time');
    const ping = str(data, 'heartbeat.ping');
    return {
      title: name && word ? `${name} is ${word}` : (name ?? str(data, 'msg')),
      status: status ?? (name ? null : 'info'),
      measured: ping ? { value: `${ping} ms`, threshold: null } : null,
      message: str(data, 'heartbeat.msg', 'msg'),
      tags: pairTags(at(data, 'monitor.tags')),
      where: fields(
        ['Host', str(data, 'monitor.hostname')],
        ['Monitor type', str(data, 'monitor.type')]
      ),
      links: links(['Checked URL', str(data, 'monitor.url')]),
      // Kuma prints UTC without a zone ("2026-11-22 15:27:00.123").
      when: times(['Changed', time && !/[zZ]|[+-]\d\d:?\d\d$/.test(time) ? `${time}Z` : time]),
    };
  },
};

/** Better Stack (Better Uptime) incident and monitor webhooks: JSON:API { data: { type, attributes } }. */
export const betterStack: SourceReader = {
  id: 'better-stack',
  name: 'Better Stack',
  detect: data => {
    if (!isObj(data)) return false;
    const attrs = at(data, 'data.attributes');
    return (
      isObj(attrs) &&
      ((oneOf(at(data, 'data.type'), 'incident') &&
        (has(attrs, 'started_at') || has(attrs, 'cause') || has(attrs, 'incident_group_id'))) ||
        (oneOf(at(data, 'data.type'), 'monitor', 'heartbeat') && has(attrs, 'pronounceable_name')))
    );
  },
  read: data => {
    const a = at(data, 'data.attributes');
    const status =
      statusFrom(str(a, 'status'), { started: 'firing', validating: 'info', paused: 'info' }) ??
      (str(a, 'resolved_at')
        ? 'resolved'
        : str(a, 'acknowledged_at')
          ? 'acknowledged'
          : oneOf(at(data, 'data.type'), 'incident')
            ? 'firing'
            : null);
    return {
      title: str(a, 'name', 'pronounceable_name', 'cause'),
      status,
      condition: str(a, 'cause'),
      where: fields(
        ['Team', str(a, 'team_name')],
        ['Regions', splitTags(str(a, 'regions')).join(', ') || null]
      ),
      links: links(
        ['Checked URL', str(a, 'url')],
        ['Open in Better Stack', str(a, 'origin_url')],
        ['Response', str(a, 'response_url')]
      ),
      images: str(a, 'screenshot_url') ? [str(a, 'screenshot_url')!] : [],
      when: times(
        ['Started', str(a, 'started_at')],
        ['Acknowledged', str(a, 'acknowledged_at')],
        ['Resolved', str(a, 'resolved_at')]
      ),
    };
  },
};

/** Checkly alert webhook (the default template's check_id / check_result_id / alert_type / result_link). */
export const checkly: SourceReader = {
  id: 'checkly',
  name: 'Checkly',
  detect: data =>
    isObj(data) &&
    has(data, 'check_id') &&
    (has(data, 'check_result_id') ||
      has(data, 'result_link') ||
      has(data, 'run_location') ||
      /^ALERT_/.test(String(at(data, 'alert_type') ?? ''))),
  read: data => {
    const type = str(data, 'alert_type') ?? '';
    const rt = str(data, 'response_time');
    return {
      title: str(data, 'alert_title', 'event', 'check_name'),
      status: /RECOVERY/.test(type)
        ? 'resolved'
        : /FAILURE|DEGRADED|SSL/.test(type)
          ? 'firing'
          : statusFrom(str(data, 'state')),
      severity: /RECOVERY/.test(type)
        ? null
        : /DEGRADED/.test(type)
          ? 'degraded'
          : /FAILURE/.test(type)
            ? 'failure'
            : null,
      condition: type || null,
      measured: rt ? { value: `${rt} ms`, threshold: null } : null,
      message: str(data, 'check_error_message', 'api_check_response_status_text'),
      tags: pairTags(at(data, 'tags')),
      where: fields(
        ['Check', str(data, 'check_name')],
        ['Location', str(data, 'run_location')],
        ['Region', str(data, 'region')],
        ['Group', str(data, 'group_name')]
      ),
      links: links(
        ['Check result', str(data, 'result_link', 'link')],
        ['Trace', str(data, 'otel_trace_link')]
      ),
      when: times(['Started', str(data, 'started_at')]),
    };
  },
};

/** StatusCake webhook: form fields Name, Status, StatusCode, URL, IP, Tags, Token, CheckRate. */
export const statuscake: SourceReader = {
  id: 'statuscake',
  name: 'StatusCake',
  detect: data =>
    isObj(data) &&
    has(data, 'Name', 'Status', 'StatusCode') &&
    (has(data, 'Token') || has(data, 'CheckRate') || has(data, 'IP')),
  read: data => {
    const name = str(data, 'Name');
    const status = str(data, 'Status');
    const code = str(data, 'StatusCode');
    return {
      title: name && status ? `${name} is ${status.toLowerCase()}` : name,
      status: statusFrom(status),
      measured: code ? { value: `HTTP ${code}`, threshold: null } : null,
      tags: splitTags(str(data, 'Tags')),
      where: fields(['IP', str(data, 'IP')]),
      links: links(['Checked URL', str(data, 'URL')]),
    };
  },
};

/** Site24x7 webhook: MONITORNAME, STATUS, INCIDENT_REASON, MONITOR_DASHBOARD_LINK, … */
export const site24x7: SourceReader = {
  id: 'site24x7',
  name: 'Site24x7',
  detect: data =>
    isObj(data) &&
    has(data, 'MONITORNAME', 'STATUS') &&
    (has(data, 'MONITOR_DASHBOARD_LINK') ||
      has(data, 'INCIDENT_REASON') ||
      has(data, 'MONITORTYPE') ||
      has(data, 'MONITOR_ID')),
  read: data => {
    const name = str(data, 'MONITORNAME');
    const status = str(data, 'STATUS');
    return {
      title: name && status ? `${name} is ${status.toLowerCase()}` : name,
      status: statusFrom(status, { trouble: 'firing', critical: 'firing' }),
      severity: oneOf(status, 'down', 'critical', 'trouble') ? lower(status) : null,
      condition: str(data, 'MONITORTYPE'),
      message: str(data, 'INCIDENT_REASON'),
      tags: splitTags(str(data, 'TAGS')),
      where: fields(
        ['Group', str(data, 'MONITOR_GROUPNAME')],
        ['Failed locations', str(data, 'FAILED_LOCATIONS')]
      ),
      links: links(
        ['Open in Site24x7', str(data, 'MONITOR_DASHBOARD_LINK')],
        ['Root cause analysis', str(data, 'RCA_LINK')],
        ['Checked URL', str(data, 'MONITORURL')]
      ),
      when: times([
        'Started',
        str(data, 'INCIDENT_TIME_ISO', 'OUTAGE_TIME_UNIX_FORMAT', 'INCIDENT_TIME'),
      ]),
    };
  },
};

/** Healthchecks.io check object (API / $JSON webhook body): { name, status, grace, n_pings, ping_url, … }. */
export const healthchecks: SourceReader = {
  id: 'healthchecks',
  name: 'Healthchecks.io',
  detect: data =>
    isObj(data) &&
    has(data, 'name', 'status') &&
    (has(data, 'ping_url') || has(data, 'update_url') || has(data, 'unique_key')) &&
    (has(data, 'n_pings') || has(data, 'grace') || has(data, 'last_ping')),
  read: data => {
    const name = str(data, 'name');
    const status = str(data, 'status');
    return {
      title: name && status ? `${name} is ${status.toLowerCase()}` : name,
      status: statusFrom(status, { grace: 'info', paused: 'info', new: 'info', started: 'info' }),
      message: str(data, 'desc'),
      tags: splitTags(str(data, 'tags'), /\s+/),
      when: times(['Last ping', str(data, 'last_ping')], ['Next ping', str(data, 'next_ping')]),
    };
  },
};

/** ManageEngine OpManager alarm webhook: { alarmid, displayName, stringseverity, message, category, … }. */
export const manageengine: SourceReader = {
  id: 'manageengine',
  name: 'ManageEngine OpManager',
  detect: data =>
    isObj(data) &&
    (has(data, 'alarmid') || has(data, 'alarmId') || has(data, 'alarm_id')) &&
    (has(data, 'stringseverity') ||
      has(data, 'stringSeverity') ||
      has(data, 'entity') ||
      has(data, 'displayName')),
  read: data => {
    const severity = str(data, 'stringseverity', 'stringSeverity');
    const acked = String(at(data, 'acknowledged') ?? at(data, 'isAcknowledged') ?? '');
    const value = str(data, 'lastPolledValue');
    return {
      title: str(data, 'message', 'alarmMessage', 'Message') ?? str(data, 'displayName'),
      status: oneOf(severity, 'clear')
        ? 'resolved'
        : /^(true|yes|1)$/i.test(acked)
          ? 'acknowledged'
          : severity
            ? 'firing'
            : null,
      severity: lower(severity),
      condition: str(data, 'eventType', 'event_type'),
      measured: value ? { value, threshold: null } : null,
      message: str(data, 'description', 'rcaMessage'),
      where: fields(
        ['Device', str(data, 'displayName', 'deviceName')],
        ['IP', str(data, 'ipAddress', 'IPADDRESS')],
        ['Category', str(data, 'category')]
      ),
      when: times(['Last update', str(data, 'modTime', 'strModTime')]),
    };
  },
};

// ───────────────────────────── Dev / CI / platform ─────────────────────────────

/** GitHub webhooks: workflow_run, check_run and deployment_status. */
export const github: SourceReader = {
  id: 'github',
  name: 'GitHub',
  detect: data =>
    isObj(data) &&
    has(data, 'repository') &&
    (isObj(at(data, 'workflow_run')) ||
      isObj(at(data, 'check_run')) ||
      isObj(at(data, 'deployment_status'))),
  read: data => {
    const repo = str(data, 'repository.full_name');
    const common = {
      repoLink: str(data, 'repository.html_url'),
      sender: str(data, 'sender.login'),
    };
    const run = at(data, 'workflow_run');
    if (isObj(run)) {
      const outcome = str(run, 'conclusion') ?? str(run, 'status');
      const branch = str(run, 'head_branch');
      return {
        title:
          `${str(run, 'name') ?? 'Workflow'} ${ciWord(outcome) ?? ''}${branch ? ` on ${branch}` : ''}`.replace(
            /\s+/g,
            ' '
          ),
        status: statusFrom(outcome, CI_STATUS),
        condition: str(run, 'display_title'),
        where: fields(
          ['Repository', repo],
          ['Branch', branch],
          ['Commit', short(str(run, 'head_sha'))],
          ['Trigger', str(run, 'event')],
          ['Actor', str(run, 'actor.login') ?? common.sender]
        ),
        links: links(
          ['Open in GitHub', str(run, 'html_url')],
          ['Workflow', str(data, 'workflow.html_url')],
          ['Repository', common.repoLink]
        ),
        when: times(
          ['Started', str(run, 'run_started_at', 'created_at')],
          ['Last update', str(run, 'updated_at')]
        ),
      };
    }
    const check = at(data, 'check_run');
    if (isObj(check)) {
      const outcome = str(check, 'conclusion') ?? str(check, 'status');
      return {
        title: `${str(check, 'name') ?? 'Check'} ${ciWord(outcome) ?? ''}`.trim(),
        status: statusFrom(outcome, CI_STATUS),
        condition: str(check, 'output.title'),
        message: str(check, 'output.summary'),
        where: fields(
          ['Repository', repo],
          ['Branch', str(check, 'check_suite.head_branch')],
          ['Commit', short(str(check, 'head_sha'))],
          ['App', str(check, 'app.name')]
        ),
        links: links(
          ['Open in GitHub', str(check, 'html_url')],
          ['Details', str(check, 'details_url')],
          ['Repository', common.repoLink]
        ),
        when: times(
          ['Started', str(check, 'started_at')],
          ['Finished', str(check, 'completed_at')]
        ),
      };
    }
    const status = at(data, 'deployment_status');
    const state = str(status, 'state');
    const env = str(status, 'environment') ?? str(data, 'deployment.environment');
    return {
      title: `Deployment to ${env ?? 'environment'} ${ciWord(state) ?? ''}`.trim(),
      status: statusFrom(state, CI_STATUS),
      message: str(status, 'description'),
      where: fields(
        ['Repository', repo],
        ['Env', env],
        ['Ref', str(data, 'deployment.ref')],
        ['Commit', short(str(data, 'deployment.sha'))],
        ['Actor', str(status, 'creator.login') ?? common.sender]
      ),
      links: links(
        ['Logs', str(status, 'log_url', 'target_url')],
        ['Environment', str(status, 'environment_url')],
        ['Repository', common.repoLink]
      ),
      when: times(['Last update', str(status, 'updated_at', 'created_at')]),
    };
  },
};

/** GitLab webhooks: pipeline, job (build), deployment, and alert / incident events. */
export const gitlab: SourceReader = {
  id: 'gitlab',
  name: 'GitLab',
  detect: data =>
    isObj(data) &&
    oneOf(
      at(data, 'object_kind'),
      'pipeline',
      'build',
      'deployment',
      'alert',
      'incident',
      'issue'
    ) &&
    (has(data, 'project') || has(data, 'repository')),
  read: data => {
    const kind = lower(str(data, 'object_kind'));
    const attrs = at(data, 'object_attributes');
    const project = str(data, 'project.path_with_namespace', 'project.name', 'project_name');
    const projectUrl = str(data, 'project.web_url', 'repository.homepage');
    if (kind === 'pipeline') {
      const status = str(attrs, 'status');
      const ref = str(attrs, 'ref');
      const failed = (Array.isArray(at(data, 'builds')) ? (at(data, 'builds') as unknown[]) : [])
        .filter(b => oneOf(at(b, 'status'), 'failed'))
        .map(b => str(b, 'name'))
        .filter(Boolean);
      return {
        title:
          `Pipeline #${str(attrs, 'iid', 'id') ?? ''} ${ciWord(status) ?? ''}${ref ? ` on ${ref}` : ''}`.replace(
            /\s+/g,
            ' '
          ),
        status: statusFrom(status, CI_STATUS),
        condition: failed.length ? `Failed jobs: ${failed.join(', ')}` : null,
        message: str(data, 'commit.title', 'commit.message'),
        where: fields(
          ['Project', project],
          ['Branch', ref],
          ['Commit', short(str(attrs, 'sha'))],
          ['Source', str(attrs, 'source')],
          ['Author', str(data, 'user.name')]
        ),
        links: links(
          ['Open in GitLab', str(attrs, 'url')],
          ['Commit', str(data, 'commit.url')],
          ['Project', projectUrl]
        ),
        when: times(['Started', str(attrs, 'created_at')], ['Finished', str(attrs, 'finished_at')]),
      };
    }
    if (kind === 'build') {
      const status = str(data, 'build_status');
      const id = str(data, 'build_id');
      return {
        title: `Job ${str(data, 'build_name') ?? ''} ${ciWord(status) ?? ''}`
          .replace(/\s+/g, ' ')
          .trim(),
        status: statusFrom(status, CI_STATUS),
        condition: str(data, 'build_failure_reason'),
        message: str(data, 'commit.message'),
        where: fields(
          ['Project', project],
          ['Branch', str(data, 'ref')],
          ['Stage', str(data, 'build_stage')],
          ['Commit', short(str(data, 'sha', 'commit.sha'))]
        ),
        links: links(['Open in GitLab', projectUrl && id ? `${projectUrl}/-/jobs/${id}` : null]),
        when: times(
          ['Started', str(data, 'build_started_at')],
          ['Finished', str(data, 'build_finished_at')]
        ),
      };
    }
    if (kind === 'deployment') {
      const status = str(data, 'status');
      const env = str(data, 'environment');
      return {
        title: `Deployment to ${env ?? 'environment'} ${ciWord(status) ?? ''}`.trim(),
        status: statusFrom(status, CI_STATUS),
        message: str(data, 'commit_title'),
        where: fields(
          ['Project', project],
          ['Env', env],
          ['Ref', str(data, 'ref')],
          ['Commit', str(data, 'short_sha')],
          ['Author', str(data, 'user.name')]
        ),
        links: links(
          ['Open in GitLab', str(data, 'deployable_url')],
          ['Environment', str(data, 'environment_external_url')],
          ['Commit', str(data, 'commit_url')]
        ),
        when: times(['Last update', str(data, 'status_changed_at')]),
      };
    }
    const state = str(attrs, 'status', 'state', 'action');
    const isIncident = kind !== 'issue' || oneOf(at(attrs, 'issue_type'), 'incident');
    return {
      title: str(attrs, 'title'),
      status:
        statusFrom(state, {
          close: 'resolved',
          opened: 'firing',
          reopen: 'firing',
          triggered: 'firing',
        }) ?? (isIncident ? 'firing' : 'info'),
      severity: lower(str(attrs, 'severity')),
      message: str(attrs, 'description'),
      where: fields(['Project', project], ['Env', str(attrs, 'environment')]),
      links: links(['Open in GitLab', str(attrs, 'url')], ['Project', projectUrl]),
      when: times(
        ['Started', str(attrs, 'started_at', 'created_at')],
        ['Resolved', str(attrs, 'ended_at', 'closed_at')]
      ),
    };
  },
};

/** Bitbucket Cloud: repo:commit_status_created/updated ({ commit_status, repository }) and pipeline relays. */
export const bitbucket: SourceReader = {
  id: 'bitbucket',
  name: 'Bitbucket',
  detect: data =>
    isObj(data) &&
    (isObj(at(data, 'commit_status')) || isObj(at(data, 'pipeline'))) &&
    (has(data, 'repository.links.html') ||
      has(data, 'repository.uuid') ||
      has(data, 'repository.full_name')) &&
    !has(data, 'repository.html_url'),
  read: data => {
    const status = at(data, 'commit_status');
    const state =
      str(status, 'state') ?? str(data, 'pipeline.state.result.name', 'pipeline.state.name');
    return {
      title: `${str(status, 'name') ?? 'Pipeline'} ${ciWord(state) ?? ''}`.trim(),
      status: statusFrom(state, CI_STATUS),
      message: str(status, 'description'),
      where: fields(
        ['Repository', str(data, 'repository.full_name', 'repository.name')],
        ['Branch', str(status, 'refname')],
        ['Commit', short(str(status, 'commit.hash'))],
        ['Actor', str(data, 'actor.display_name')]
      ),
      links: links(
        ['Open build', str(status, 'url')],
        ['Repository', str(data, 'repository.links.html.href')]
      ),
      when: times(
        ['Started', str(status, 'created_on')],
        ['Last update', str(status, 'updated_on')]
      ),
    };
  },
};

/** Vercel deployment webhooks: { type: "deployment.error" | …, payload: { deployment, links, target, … } }. */
export const vercel: SourceReader = {
  id: 'vercel',
  name: 'Vercel',
  detect: data =>
    isObj(data) &&
    /^deployment[.-]/.test(String(at(data, 'type') ?? '')) &&
    isObj(at(data, 'payload')) &&
    (isObj(at(data, 'payload.deployment')) || has(data, 'payload.links.deployment')),
  read: data => {
    const outcome = (str(data, 'type') ?? '').replace(/^deployment[.-]/, '');
    const p = at(data, 'payload');
    const name = str(p, 'deployment.name', 'name');
    const target = str(p, 'target');
    const host = str(p, 'deployment.url', 'url');
    return {
      title:
        `${name ?? 'Deployment'} ${target ? `${target} ` : ''}deployment ${ciWord(outcome) ?? ''}`.trim(),
      status: statusFrom(outcome, CI_STATUS),
      message: str(p, 'error.message', 'deployment.meta.githubCommitMessage'),
      where: fields(
        ['Project', name],
        ['Env', target],
        ['Branch', str(p, 'deployment.meta.githubCommitRef', 'deployment.meta.gitlabCommitRef')],
        [
          'Commit',
          short(str(p, 'deployment.meta.githubCommitSha', 'deployment.meta.gitlabCommitSha')),
        ],
        ['Region', str(data, 'region')]
      ),
      links: links(
        ['Open in Vercel', str(p, 'links.deployment', 'deployment.inspectorUrl')],
        ['Project', str(p, 'links.project')],
        ['Preview', host ? (isHttpUrl(host) ? host : `https://${host}`) : null]
      ),
      when: times(['Last update', str(data, 'createdAt')]),
    };
  },
};

/** Jenkins Notification plugin: { name, url, build: { full_url, number, phase, status, scm, … } }. */
export const jenkins: SourceReader = {
  id: 'jenkins',
  name: 'Jenkins',
  detect: data =>
    isObj(data) &&
    has(data, 'name', 'build.phase', 'build.number') &&
    (has(data, 'build.full_url') || has(data, 'build.url')),
  read: data => {
    const phase = lower(str(data, 'build.phase'));
    const result = str(data, 'build.status');
    const done = phase === 'completed' || phase === 'finalized';
    return {
      title:
        `${str(data, 'name')} #${str(data, 'build.number')} ${done ? (ciWord(result) ?? '') : (phase ?? '')}`.trim(),
      status: done ? statusFrom(result, CI_STATUS) : 'info',
      severity: oneOf(result, 'unstable') ? 'unstable' : null,
      message: str(data, 'build.log', 'build.notes'),
      where: fields(
        ['Job', str(data, 'name')],
        ['Branch', str(data, 'build.scm.branch')],
        ['Commit', short(str(data, 'build.scm.commit'))]
      ),
      links: links(
        ['Open in Jenkins', str(data, 'build.full_url')],
        ['Repository', str(data, 'build.scm.url')]
      ),
      when: times(['Started', str(data, 'build.timestamp')]),
    };
  },
};

/** Kubernetes Event objects (core/v1 and events.k8s.io/v1), as kubernetes-event-exporter and friends forward. */
export const kubernetesEvent: SourceReader = {
  id: 'kubernetes',
  name: 'Kubernetes',
  detect: data =>
    isObj(data) &&
    at(data, 'kind') === 'Event' &&
    has(data, 'reason') &&
    (isObj(at(data, 'involvedObject')) || isObj(at(data, 'regarding'))),
  read: data => {
    const object = at(data, 'involvedObject') ?? at(data, 'regarding');
    const kind = str(object, 'kind');
    const name = str(object, 'name');
    const reason = str(data, 'reason');
    const type = str(data, 'type');
    const count = str(data, 'count', 'series.count', 'deprecatedCount');
    return {
      title: [reason, kind && name ? `${kind}/${name}` : name].filter(Boolean).join(': ') || null,
      status: oneOf(type, 'warning') ? 'firing' : oneOf(type, 'normal') ? 'info' : null,
      severity: lower(type),
      condition: reason,
      measured: count && count !== '1' ? { value: `${count} times`, threshold: null } : null,
      message: str(data, 'message', 'note'),
      where: fields(
        ['Namespace', str(object, 'namespace') ?? str(data, 'metadata.namespace')],
        ['Object', kind && name ? `${kind}/${name}` : name],
        ['Node', str(data, 'source.host', 'deprecatedSource.host')],
        ['Component', str(data, 'source.component', 'reportingComponent', 'reportingController')],
        ['Cluster', str(data, 'clusterName', 'cluster')]
      ),
      when: times(
        ['Started', str(data, 'firstTimestamp', 'eventTime', 'deprecatedFirstTimestamp')],
        [
          'Last update',
          str(data, 'lastTimestamp', 'series.lastObservedTime', 'deprecatedLastTimestamp'),
        ]
      ),
    };
  },
};

const argoApp = (data: Obj): unknown =>
  isObj(at(data, 'app'))
    ? at(data, 'app')
    : isObj(at(data, 'application'))
      ? at(data, 'application')
      : data;

/** Argo CD notifications whose webhook template sends the Application ({{toJson .app}} or the object itself). */
export const argocd: SourceReader = {
  id: 'argocd',
  name: 'Argo CD',
  detect: data => {
    if (!isObj(data)) return false;
    const app = argoApp(data);
    return (
      String(at(app, 'apiVersion') ?? '').startsWith('argoproj.io') ||
      (has(app, 'metadata.name', 'spec.destination') &&
        (has(app, 'status.sync.status') || has(app, 'status.health.status')))
    );
  },
  read: data => {
    const app = argoApp(data);
    const name = str(app, 'metadata.name');
    const health = str(app, 'status.health.status');
    const sync = str(app, 'status.sync.status');
    const phase = str(app, 'status.operationState.phase');
    const base = str(data, 'context.argocdUrl');
    return {
      title: `${name ?? 'Application'}: ${[health, sync, phase && phase !== 'Succeeded' ? phase : null].filter(Boolean).join(' / ') || 'updated'}`,
      status:
        oneOf(phase, 'failed', 'error') || oneOf(health, 'degraded', 'missing')
          ? 'firing'
          : oneOf(health, 'healthy') && !oneOf(sync, 'outofsync')
            ? 'resolved'
            : 'info',
      severity: lower(health),
      condition: phase ? `Sync ${phase.toLowerCase()}` : null,
      message: str(app, 'status.operationState.message', 'status.health.message'),
      where: fields(
        ['App', name],
        ['Project', str(app, 'spec.project')],
        ['Namespace', str(app, 'spec.destination.namespace')],
        ['Cluster', str(app, 'spec.destination.name', 'spec.destination.server')],
        ['Revision', short(str(app, 'status.sync.revision'))]
      ),
      links: links(
        [
          'Open in Argo CD',
          base && name ? `${base.replace(/\/$/, '')}/applications/${name}` : null,
        ],
        ['Repository', str(app, 'spec.source.repoURL')]
      ),
      when: times(
        ['Started', str(app, 'status.operationState.startedAt')],
        ['Finished', str(app, 'status.operationState.finishedAt')]
      ),
    };
  },
};

const STATUSPAGE_STATUS: Record<string, PayloadStatus> = {
  investigating: 'firing',
  identified: 'firing',
  monitoring: 'acknowledged',
  resolved: 'resolved',
  postmortem: 'resolved',
  scheduled: 'info',
  in_progress: 'info',
  verifying: 'info',
  completed: 'resolved',
  operational: 'resolved',
  degraded_performance: 'firing',
  partial_outage: 'firing',
  major_outage: 'firing',
  under_maintenance: 'info',
};

/** Atlassian Statuspage subscriber webhook: { meta, page: { status_indicator }, incident | component_update }. */
export const statuspage: SourceReader = {
  id: 'statuspage',
  name: 'Atlassian Statuspage',
  detect: data =>
    isObj(data) &&
    has(data, 'page.status_indicator') &&
    (isObj(at(data, 'incident')) ||
      isObj(at(data, 'component_update')) ||
      isObj(at(data, 'component'))),
  read: data => {
    const incident = at(data, 'incident');
    if (isObj(incident)) {
      const affected = (
        Array.isArray(at(incident, 'components')) ? (at(incident, 'components') as unknown[]) : []
      )
        .map(c => str(c, 'name'))
        .filter(Boolean)
        .join(', ');
      return {
        title: str(incident, 'name'),
        status: statusFrom(str(incident, 'status'), STATUSPAGE_STATUS),
        severity: lower(str(incident, 'impact') ?? str(data, 'page.status_indicator')),
        message: str(incident, 'incident_updates.0.body'),
        where: fields(
          ['Components', affected || null],
          ['Page status', str(data, 'page.status_description')]
        ),
        links: links(['Open status page incident', str(incident, 'shortlink')]),
        when: times(
          ['Started', str(incident, 'started_at', 'created_at')],
          ['Last update', str(incident, 'updated_at')],
          ['Resolved', str(incident, 'resolved_at')]
        ),
      };
    }
    const component = at(data, 'component');
    const status = str(data, 'component_update.new_status') ?? str(component, 'status');
    const name = str(component, 'name');
    return {
      title: name && status ? `${name}: ${status.replace(/_/g, ' ')}` : name,
      status: statusFrom(status, STATUSPAGE_STATUS),
      severity: lower(str(data, 'page.status_indicator')),
      condition: str(data, 'component_update.old_status')
        ? `${str(data, 'component_update.old_status')} → ${status}`
        : null,
      where: fields(['Component', name], ['Page status', str(data, 'page.status_description')]),
      when: times(['Changed', str(data, 'component_update.created_at')]),
    };
  },
};

const GRAYLOG_PRIORITY: Record<string, string> = {
  '1': 'low',
  '2': 'normal',
  '3': 'high',
  '4': 'critical',
};

/** Graylog event notification (HTTP / legacy JSON): { event_definition_title, event: {…}, backlog: […] }. */
export const graylog: SourceReader = {
  id: 'graylog',
  name: 'Graylog',
  detect: data =>
    isObj(data) &&
    has(data, 'event_definition_id') &&
    isObj(at(data, 'event')) &&
    (has(data, 'backlog') || has(data, 'event_definition_title')),
  read: data => {
    const event = at(data, 'event');
    const priority = str(event, 'priority');
    const backlog = at(data, 'backlog');
    return {
      title: str(data, 'event_definition_title') ?? str(event, 'message'),
      status: at(event, 'alert') === false ? 'info' : 'firing',
      // eslint-disable-next-line security/detect-object-injection -- looks up a status or level in a fixed table, with a fallback
      severity: priority ? (GRAYLOG_PRIORITY[priority] ?? priority.toLowerCase()) : null,
      condition: str(data, 'event_definition_description'),
      measured:
        Array.isArray(backlog) && backlog.length
          ? { value: `${backlog.length} messages in backlog`, threshold: null }
          : null,
      message: str(event, 'message'),
      tags: labelTags(at(event, 'fields')),
      where: fields(['Source', str(event, 'source')], ['Key', str(event, 'key')]),
      when: times(
        ['Started', str(event, 'timerange_start', 'timestamp')],
        ['Finished', str(event, 'timerange_end')]
      ),
    };
  },
};

/**
 * Most specific first. Shape-unique readers (envelopes with tool-only keys) lead; Icinga sits before Nagios
 * because Icinga speaks the Nagios macro vocabulary plus its own keys.
 */
export const TOOL_READERS: SourceReader[] = [
  sentry,
  bugsnag,
  rollbar,
  raygun,
  pagerduty,
  opsgenie,
  splunkOnCall,
  statuspage,
  graylog,
  kubernetesEvent,
  argocd,
  github,
  gitlab,
  bitbucket,
  vercel,
  jenkins,
  zabbix,
  icinga,
  nagios,
  netdata,
  betterStack,
  uptimeKuma,
  pingdom,
  checkly,
  uptimerobot,
  site24x7,
  statuscake,
  healthchecks,
  manageengine,
];

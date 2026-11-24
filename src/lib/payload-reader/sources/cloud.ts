import type {
  PayloadStatus,
  ReadableField,
  ReadableLink,
  ReadableTime,
  SourceReader,
} from '../types';
import { asTime, humanKey, isHttpUrl, normalizeStatus } from '../generic';
import { alertmanager } from './core';
import { at, has, isObj, labelTags, str, type Obj } from './helpers';

/**
 * Cloud and observability platforms. Each reader detects its payloads by the keys that tool documents (not by a
 * "source" string) and reads only what it sends; the generic reader fills the rest.
 */

/** [label, url] pairs → links, keeping http(s) URLs only. */
function links(...pairs: Array<[string, string | null]>): ReadableLink[] {
  return pairs
    .filter((pair): pair is [string, string] => Boolean(pair[1]) && isHttpUrl(pair[1]!))
    .map(([label, url]) => ({ label, url }));
}

/** [label, value] pairs → where fields, skipping empty values. */
function fields(...pairs: Array<[string, string | null]>): ReadableField[] {
  return pairs
    .filter((pair): pair is [string, string] => Boolean(pair[1]))
    .map(([label, value]) => ({ label, value }));
}

/** [label, time] pairs → ISO times. Also takes RFC 1123 / Java dates ("Fri, 27 Jan 2023 06:02:51 GMT"). */
function times(...pairs: Array<[string, string | null]>): ReadableTime[] {
  return pairs.flatMap(([label, value]) => {
    if (!value) return [];
    const parsed = /^[A-Za-z]/.test(value) ? Date.parse(value) : NaN;
    const iso = asTime(value) ?? (Number.isNaN(parsed) ? null : new Date(parsed).toISOString());
    return iso ? [{ label, at: iso }] : [];
  });
}

/** Status by the tool's own words first, then the shared vocabulary. */
function statusOf(
  value: string | null,
  own: Record<string, PayloadStatus> = {}
): PayloadStatus | null {
  if (!value) return null;
  return lookup(own, value.trim().toLowerCase()) ?? normalizeStatus(value);
}

/** A table lookup that payload keys like "constructor" cannot reach past. */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined; // eslint-disable-line security/detect-object-injection
}

function lower(data: unknown, ...paths: string[]): string | null {
  return str(data, ...paths)?.toLowerCase() ?? null;
}

/** Strings of an array (or a lone string) joined for display. */
function list(value: unknown): string | null {
  const items = (Array.isArray(value) ? value : [value]).filter(
    (v): v is string | number => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number'
  );
  return items.length ? items.join(', ') : null;
}

/** An object of plain values → where fields, keys as written ("service.name" stays one key). */
function objFields(value: unknown): ReadableField[] {
  return isObj(value)
    ? Object.entries(value)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([label, v]) => ({ label, value: String(v) }))
    : [];
}

function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string');
  return typeof value === 'string'
    ? value
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
    : [];
}

// ─── AWS ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The message inside an SNS notification envelope (the format layer has already parsed `Message`). */
function unwrapSns(data: unknown): unknown {
  return isObj(data) && str(data, 'Type') === 'Notification' && isObj(data.Message)
    ? data.Message
    : data;
}

const CLOUDWATCH_STATUS: Record<string, PayloadStatus> = {
  alarm: 'firing',
  ok: 'resolved',
  insufficient_data: 'info',
};

const CLOUDWATCH_OPS: Record<string, string> = {
  GreaterThanThreshold: '>',
  GreaterThanOrEqualToThreshold: '>=',
  LessThanThreshold: '<',
  LessThanOrEqualToThreshold: '<=',
  LessThanLowerOrGreaterThanUpperThreshold: 'outside the band',
  GreaterThanUpperThreshold: 'above the band',
  LessThanLowerThreshold: 'below the band',
};

/** `arn:aws:cloudwatch:<region>:<account>:alarm:<name>` → the alarm in the CloudWatch console. */
function cloudWatchConsole(arn: string | null): string | null {
  const m = /^arn:aws[\w-]*:cloudwatch:([a-z0-9-]+):\d*:alarm:(.+)$/.exec(arn ?? '');
  return m
    ? `https://${m[1]}.console.aws.amazon.com/cloudwatch/home?region=${m[1]}#alarmsV2:alarm/${encodeURIComponent(m[2]!)}`
    : null;
}

/** AWS CloudWatch alarm: the SNS notification (alarm JSON in `Message`) or EventBridge "CloudWatch Alarm State Change". */
export const awsCloudWatch: SourceReader = {
  id: 'aws-cloudwatch',
  name: 'AWS CloudWatch',
  detect: data => {
    const alarm = unwrapSns(data);
    return (
      isObj(alarm) &&
      (has(alarm, 'AlarmName', 'NewStateValue') ||
        (str(alarm, 'detail-type') === 'CloudWatch Alarm State Change' &&
          has(alarm, 'detail.alarmName')))
    );
  },
  read: data => {
    const alarm = unwrapSns(data);
    if (has(alarm, 'detail.alarmName')) {
      const d = at(alarm, 'detail');
      const metric = at(d, 'configuration.metrics.0.metricStat');
      const points = at(d, 'state.reasonData.recentDatapoints');
      const value = Array.isArray(points)
        ? str(points, String(points.length - 1))
        : str(d, 'state.reasonData.evaluatedDatapoints.0.value');
      const metricName = str(metric, 'metric.name');
      return {
        title: str(d, 'alarmName'),
        status: statusOf(str(d, 'state.value'), CLOUDWATCH_STATUS),
        condition: metricName
          ? [str(metric, 'stat'), str(metric, 'metric.namespace'), metricName]
              .filter(Boolean)
              .join(' ')
          : str(d, 'configuration.metrics.0.expression'),
        measured: value ? { value, threshold: str(d, 'state.reasonData.threshold') } : null,
        message:
          [str(d, 'configuration.description'), str(d, 'state.reason')]
            .filter(Boolean)
            .join('\n\n') || null,
        where: [
          ...fields(['Account', str(alarm, 'account')], ['Region', str(alarm, 'region')]),
          ...objFields(at(metric, 'metric.dimensions')),
        ],
        when: times(['Changed', str(d, 'state.timestamp')]),
        links: links(['Open in CloudWatch', cloudWatchConsole(str(alarm, 'resources.0'))]),
      };
    }
    const op = str(alarm, 'Trigger.ComparisonOperator');
    const threshold = str(alarm, 'Trigger.Threshold');
    const metric =
      str(alarm, 'Trigger.MetricName') ??
      (Array.isArray(at(alarm, 'Trigger.Metrics'))
        ? (at(alarm, 'Trigger.Metrics') as unknown[])
            .map(m => str(m, 'Expression', 'MetricStat.Metric.MetricName'))
            .find(Boolean)
        : null) ??
      null;
    const period = str(alarm, 'Trigger.Period');
    const periods = str(alarm, 'Trigger.EvaluationPeriods');
    const dims = at(alarm, 'Trigger.Dimensions');
    // "… 1 out of the last 1 datapoints [85.5 (23/11/26 10:00:00)] was greater than the threshold (80.0)"
    const value = /\[\s*([-+\d.eE]+)\s*\(/.exec(str(alarm, 'NewStateReason') ?? '')?.[1];
    return {
      title: str(alarm, 'AlarmName'),
      status: statusOf(str(alarm, 'NewStateValue'), CLOUDWATCH_STATUS),
      condition: metric
        ? [
            str(alarm, 'Trigger.Statistic', 'Trigger.ExtendedStatistic'),
            metric,
            op && threshold ? `${lookup(CLOUDWATCH_OPS, op) ?? op} ${threshold}` : null,
            periods && period ? `for ${periods} × ${period}s` : null,
          ]
            .filter(Boolean)
            .join(' ')
        : null,
      measured: value ? { value, threshold } : null,
      message:
        [str(alarm, 'AlarmDescription'), str(alarm, 'NewStateReason')]
          .filter(Boolean)
          .join('\n\n') || null,
      where: [
        ...fields(
          ['Account', str(alarm, 'AWSAccountId')],
          ['Region', str(alarm, 'Region')],
          ['Namespace', str(alarm, 'Trigger.Namespace')]
        ),
        ...(Array.isArray(dims)
          ? fields(
              ...dims.map(
                dim =>
                  [str(dim, 'name') ?? 'Dimension', str(dim, 'value')] as [string, string | null]
              )
            )
          : []),
      ],
      when: times(['Changed', str(alarm, 'StateChangeTime')]),
      links: links(['Open in CloudWatch', cloudWatchConsole(str(alarm, 'AlarmArn'))]),
    };
  },
};

const isEventBridge = (event: unknown) =>
  isObj(event) &&
  typeof event['detail-type'] === 'string' &&
  /^aws\./.test(str(event, 'source') ?? '') &&
  isObj(event.detail);

/** AWS Health event, as EventBridge delivers it ("AWS Health Event", source aws.health). */
export const awsHealth: SourceReader = {
  id: 'aws-health',
  name: 'AWS Health',
  detect: data => {
    const event = unwrapSns(data);
    return isEventBridge(event) && str(event, 'source') === 'aws.health';
  },
  read: data => {
    const event = unwrapSns(data);
    const d = at(event, 'detail');
    const service = str(d, 'service');
    // AWS_EC2_OPERATIONAL_ISSUE → "operational issue"
    const code = str(d, 'eventTypeCode');
    const prefix = `AWS_${service ?? ''}_`;
    const type = (code?.startsWith(prefix) ? code.slice(prefix.length) : code)
      ?.replace(/_/g, ' ')
      .toLowerCase();
    const descriptions = at(d, 'eventDescription');
    const entities = at(d, 'affectedEntities');
    return {
      title: [service, type].filter(Boolean).join(' ') || str(event, 'detail-type'),
      status: statusOf(str(d, 'statusCode'), { upcoming: 'info' }),
      condition: str(d, 'eventTypeCategory'),
      message: Array.isArray(descriptions)
        ? str(
            descriptions.find(x => str(x, 'language') === 'en_US') ?? descriptions[0],
            'latestDescription'
          )
        : null,
      where: fields(
        ['Service', service],
        ['Region', str(d, 'eventRegion') ?? str(event, 'region')],
        ['Account', str(d, 'affectedAccount') ?? str(event, 'account')],
        ['Scope', str(d, 'eventScopeCode')],
        [
          'Affected',
          Array.isArray(entities) ? list(entities.map(e => str(e, 'entityValue'))) : null,
        ]
      ),
      when: times(
        ['Started', str(d, 'startTime')],
        ['Resolved', str(d, 'endTime')],
        ['Last update', str(d, 'lastUpdatedTime')]
      ),
    };
  },
};

/** GuardDuty's numeric severity → its documented band. */
function guardDutyBand(value: number): string {
  return value >= 9 ? 'critical' : value >= 7 ? 'high' : value >= 4 ? 'medium' : 'low';
}

/** Any other AWS EventBridge event (GuardDuty, Security Hub, EC2, ECS…): the envelope is the same. */
export const awsEventBridge: SourceReader = {
  id: 'aws-eventbridge',
  name: 'AWS EventBridge',
  detect: data => isEventBridge(unwrapSns(data)) && has(unwrapSns(data), 'account'),
  read: data => {
    const event = unwrapSns(data);
    const d = at(event, 'detail');
    const finding = at(d, 'findings.0'); // Security Hub
    const severity = at(d, 'severity');
    return {
      title: str(d, 'title') ?? str(finding, 'Title') ?? str(event, 'detail-type'),
      status: statusOf(str(d, 'state', 'status')),
      severity:
        typeof severity === 'number'
          ? guardDutyBand(severity)
          : (lower(d, 'severity') ?? lower(finding, 'Severity.Label')),
      condition: str(d, 'type') ?? str(finding, 'Types.0'),
      message: str(d, 'description') ?? str(finding, 'Description'),
      where: fields(
        ['Event', str(event, 'detail-type')],
        ['Source', str(event, 'source')],
        ['Account', str(event, 'account')],
        ['Region', str(event, 'region')],
        ['Resource', str(event, 'resources.0')]
      ),
      when: times(['Occurred', str(event, 'time')]),
    };
  },
};

// ─── Azure ──────────────────────────────────────────────────────────────────────────────────────────────────

const AZURE_STATUS: Record<string, PayloadStatus> = {
  fired: 'firing',
  activated: 'firing',
  resolved: 'resolved',
  deactivated: 'resolved',
};

const AZURE_OPS: Record<string, string> = {
  GreaterThan: '>',
  GreaterThanOrEqual: '>=',
  LessThan: '<',
  LessThanOrEqual: '<=',
  Equal: '=',
  GreaterOrLessThan: 'outside the band',
};

/** "Sev3" / 3 / "3" → "sev3". */
function azureSeverity(value: string | null): string | null {
  if (!value) return null;
  return /^\d$/.test(value) ? `sev${value}` : value.toLowerCase();
}

/** One metric / log-search criterion → "Average Percentage CPU > 80 over PT5M". */
function azureCriterion(c: unknown, window: string | null): string | null {
  const subject =
    str(c, 'metricName', 'metricMeasureColumn') ?? (has(c, 'searchQuery') ? 'results' : null);
  if (!subject) return null;
  const op = str(c, 'operator');
  return [
    str(c, 'timeAggregation'),
    subject,
    op ? (lookup(AZURE_OPS, op) ?? op) : null,
    str(c, 'threshold'),
    window ? `over ${window}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function azureDimensions(c: unknown): ReadableField[] {
  const dims = at(c, 'dimensions');
  return Array.isArray(dims)
    ? fields(
        ...dims
          .filter(dim => str(dim, 'name') !== 'ResourceId')
          .map(
            dim => [str(dim, 'name') ?? 'Dimension', str(dim, 'value')] as [string, string | null]
          )
      )
    : [];
}

const isAzureCommon = (data: unknown) =>
  /^azuremonitorcommonalertschema$/i.test(str(data, 'schemaId') ?? '') ||
  has(data, 'data.essentials.alertRule', 'data.essentials.monitorCondition');
const azureMetricContext = (data: unknown) => {
  const ctx = at(data, 'data.context') ?? at(data, 'context');
  return isObj(ctx) &&
    has(ctx, 'conditionType') &&
    (has(ctx, 'resourceId') || has(ctx, 'portalLink'))
    ? ctx
    : null;
};
const azureLogAlert = (data: unknown) => {
  const log = has(data, 'data.AlertRuleName') ? at(data, 'data') : data;
  return has(log, 'AlertRuleName') && (has(log, 'SearchQuery') || has(log, 'LinkToSearchResults'))
    ? log
    : null;
};

/** Azure Monitor: the Common Alert Schema, plus the legacy metric-alert and Log Analytics alert payloads. */
export const azureMonitor: SourceReader = {
  id: 'azure-monitor',
  name: 'Azure Monitor',
  detect: data =>
    isObj(data) && (isAzureCommon(data) || !!azureMetricContext(data) || !!azureLogAlert(data)),
  read: data => {
    if (isAzureCommon(data)) {
      const e = at(data, 'data.essentials');
      const ctx = at(data, 'data.alertContext');
      const criterion = at(ctx, 'condition.allOf.0');
      const alertId = str(e, 'alertId');
      const target = str(e, 'alertTargetIDs.0') ?? '';
      const query = str(criterion, 'searchQuery') ?? str(ctx, 'SearchQuery');
      return {
        title: str(e, 'alertRule'),
        status: statusOf(str(e, 'monitorCondition'), AZURE_STATUS),
        severity: azureSeverity(str(e, 'severity')),
        condition: azureCriterion(criterion, str(ctx, 'condition.windowSize')),
        measured: str(criterion, 'metricValue')
          ? { value: str(criterion, 'metricValue')!, threshold: str(criterion, 'threshold') }
          : null,
        query: query ? { language: 'KQL', text: query } : null,
        message: str(e, 'description'),
        where: [
          ...fields(
            ['Resource', str(e, 'configurationItems.0')],
            ['Resource group', str(e, 'targetResourceGroup')],
            ['Resource type', str(e, 'targetResourceType')],
            ['Subscription', /\/subscriptions\/([^/]+)/i.exec(target)?.[1] ?? null],
            ['Signal', str(e, 'signalType')],
            ['Monitor service', str(e, 'monitoringService')]
          ),
          ...azureDimensions(criterion),
        ],
        when: times(['Started', str(e, 'firedDateTime')], ['Resolved', str(e, 'resolvedDateTime')]),
        links: links(
          [
            'Open in Azure',
            str(e, 'investigationLink') ??
              (alertId
                ? `https://portal.azure.com/#blade/Microsoft_Azure_Monitoring/AlertDetailsTemplateBlade/alertId/${encodeURIComponent(alertId)}`
                : null),
          ],
          ['Log results', str(criterion, 'linkToFilteredSearchResultsUI', 'linkToSearchResultsUI')]
        ),
        tags: labelTags(at(data, 'data.customProperties')),
      };
    }
    const ctx = azureMetricContext(data);
    if (ctx) {
      const criterion = at(ctx, 'condition.allOf.0') ?? at(ctx, 'condition');
      return {
        title: str(ctx, 'name'),
        status: statusOf(str(data, 'data.status', 'status'), AZURE_STATUS),
        severity: azureSeverity(str(ctx, 'severity')),
        condition: azureCriterion(criterion, str(ctx, 'condition.windowSize')),
        measured: str(criterion, 'metricValue')
          ? { value: str(criterion, 'metricValue')!, threshold: str(criterion, 'threshold') }
          : null,
        message: str(ctx, 'description'),
        where: [
          ...fields(
            ['Resource', str(ctx, 'resourceName')],
            ['Resource group', str(ctx, 'resourceGroupName')],
            ['Resource type', str(ctx, 'resourceType')],
            ['Subscription', str(ctx, 'subscriptionId')],
            ['Region', str(ctx, 'resourceRegion')]
          ),
          ...azureDimensions(criterion),
        ],
        when: times(['Started', str(ctx, 'timestamp')]),
        links: links(['Open in Azure', str(ctx, 'portalLink')]),
      };
    }
    const log = azureLogAlert(data);
    const op = str(log, 'AlertThresholdOperator');
    const query = str(log, 'SearchQuery');
    return {
      title: str(log, 'AlertRuleName'),
      severity: azureSeverity(str(log, 'Severity')),
      condition: op
        ? `${str(log, 'AlertType') ?? 'Number of results'} ${op.toLowerCase()} ${str(log, 'AlertThresholdValue') ?? ''}`.trim()
        : null,
      measured: str(log, 'ResultCount')
        ? { value: str(log, 'ResultCount')!, threshold: str(log, 'AlertThresholdValue') }
        : null,
      query: query ? { language: 'KQL', text: query } : null,
      message: str(log, 'Description'),
      where: fields(
        ['Subscription', str(log, 'SubscriptionId')],
        ['Workspace', str(log, 'WorkspaceId')]
      ),
      when: times(
        ['Window start', str(log, 'SearchIntervalStartTimeUtc')],
        ['Window end', str(log, 'SearchIntervalEndtimeUtc')]
      ),
      links: links([
        'Log results',
        str(log, 'LinkToFilteredSearchResultsUI', 'LinkToSearchResults'),
      ]),
    };
  },
};

// ─── Google Cloud ───────────────────────────────────────────────────────────────────────────────────────────

/** Google Cloud Monitoring incident webhook (schema 1.2). */
export const googleCloudMonitoring: SourceReader = {
  id: 'google-cloud-monitoring',
  name: 'Google Cloud Monitoring',
  detect: data =>
    isObj(data) &&
    isObj(data.incident) &&
    has(data, 'incident.incident_id') &&
    (has(data, 'incident.policy_name') ||
      has(data, 'incident.scoping_project_id') ||
      has(data, 'incident.condition_name')),
  read: data => {
    const i = at(data, 'incident');
    const promql = str(i, 'condition.conditionPrometheusQueryLanguage.query');
    const mql = str(i, 'condition.conditionMonitoringQueryLanguage.query');
    const filter = str(
      i,
      'condition.conditionThreshold.filter',
      'condition.conditionAbsent.filter'
    );
    const docLinks = at(i, 'documentation.links');
    const severity = lower(i, 'severity');
    const value = str(i, 'observed_value');
    return {
      title: str(i, 'policy_name') ?? str(i, 'summary'),
      status: statusOf(str(i, 'state')),
      severity: severity === 'no severity' ? null : severity,
      condition: str(i, 'condition_name', 'condition.displayName'),
      measured: value ? { value, threshold: str(i, 'threshold_value') } : null,
      query: promql
        ? { language: 'PromQL', text: promql }
        : mql
          ? { language: 'MQL', text: mql }
          : filter
            ? { language: 'Monitoring filter', text: filter }
            : null,
      message:
        [str(i, 'summary'), str(i, 'documentation.content')].filter(Boolean).join('\n\n') || null,
      where: fields(
        ['Project', str(i, 'scoping_project_id', 'resource.labels.project_id')],
        ['Resource', str(i, 'resource_display_name', 'resource_name')],
        ['Resource type', str(i, 'resource_type_display_name', 'resource.type')],
        ['Metric', str(i, 'metric.displayName', 'metric.type')],
        ['Zone', str(i, 'resource.labels.zone', 'resource.labels.location')]
      ),
      when: times(['Started', str(i, 'started_at')], ['Resolved', str(i, 'ended_at')]),
      links: [
        ...links(['Open in Cloud Monitoring', str(i, 'url')]),
        ...(Array.isArray(docLinks)
          ? links(
              ...docLinks.map(
                l => [str(l, 'displayName') ?? 'Docs', str(l, 'url')] as [string, string | null]
              )
            )
          : []),
      ],
      tags: [
        ...labelTags(at(i, 'policy_user_labels')),
        ...labelTags(at(i, 'metadata.user_labels')),
        ...labelTags(at(i, 'metric.labels')),
      ],
    };
  },
};

// ─── New Relic ──────────────────────────────────────────────────────────────────────────────────────────────

const NEW_RELIC_STATUS: Record<string, PayloadStatus> = {
  created: 'firing',
  activated: 'firing',
  open: 'firing',
  acknowledged: 'acknowledged',
  closed: 'resolved',
};

const isNewRelicWorkflow = (data: unknown) =>
  /newrelic\.com/.test(str(data, 'issueUrl', 'issuePageUrl') ?? '') ||
  (has(data, 'state') &&
    (has(data, 'issueId') || has(data, 'id')) &&
    (has(data, 'alertPolicyNames') ||
      has(data, 'alertConditionNames') ||
      has(data, 'totalIncidents')));
const isNewRelicLegacy = (data: unknown) =>
  has(data, 'incident_id', 'current_state') &&
  (has(data, 'policy_name') || has(data, 'condition_name') || has(data, 'incident_url'));

/** New Relic: the Workflows webhook (default issue template) and the legacy alert-channel webhook. */
export const newRelic: SourceReader = {
  id: 'newrelic',
  name: 'New Relic',
  detect: data => isObj(data) && (isNewRelicWorkflow(data) || isNewRelicLegacy(data)),
  read: data => {
    if (isNewRelicLegacy(data) && !isNewRelicWorkflow(data)) {
      return {
        title: str(data, 'condition_name') ?? str(data, 'details'),
        status: statusOf(str(data, 'current_state'), NEW_RELIC_STATUS),
        severity: lower(data, 'severity'),
        condition: str(data, 'details'),
        where: fields(
          ['Policy', str(data, 'policy_name')],
          ['Account', str(data, 'account_name', 'account_id')],
          ['Target', str(data, 'targets.0.name')],
          ['Product', str(data, 'targets.0.product')]
        ),
        when: times(['Last update', str(data, 'timestamp')]),
        links: links(
          ['Open in New Relic', str(data, 'incident_url')],
          ['Runbook', str(data, 'runbook_url')],
          ['Policy', str(data, 'policy_url')]
        ),
        images: str(data, 'violation_chart_url') ? [str(data, 'violation_chart_url')!] : [],
        tags: labelTags(at(data, 'targets.0.labels')),
      };
    }
    const conditions = list(at(data, 'alertConditionNames'));
    return {
      title: str(data, 'title') ?? conditions,
      status: statusOf(str(data, 'state'), NEW_RELIC_STATUS),
      severity: lower(data, 'priority'),
      condition: conditions,
      message: str(data, 'conditionDescription', 'description'),
      where: fields(
        ['Policy', list(at(data, 'alertPolicyNames'))],
        ['Entities', list(at(data, 'impactedEntities') ?? at(data, 'entitiesData.names'))],
        ['Account', str(data, 'accountName', 'accountId')],
        ['Workflow', str(data, 'workflowName')],
        ['Incidents', str(data, 'totalIncidents')]
      ),
      when: times(
        ['Started', str(data, 'createdAt')],
        ['Last update', str(data, 'updatedAt')],
        ['Resolved', str(data, 'closedAt')]
      ),
      links: links(
        ['Open in New Relic', str(data, 'issueUrl', 'issuePageUrl')],
        ['Runbook', str(data, 'runbookUrl')]
      ),
      images: str(data, 'violationChartUrl') ? [str(data, 'violationChartUrl')!] : [],
    };
  },
};

// ─── APM / observability platforms ──────────────────────────────────────────────────────────────────────────

/** Dynatrace problem notification (the default custom-integration payload). */
export const dynatrace: SourceReader = {
  id: 'dynatrace',
  name: 'Dynatrace',
  detect: data =>
    isObj(data) &&
    has(data, 'ProblemID') &&
    (has(data, 'ProblemTitle') || has(data, 'ProblemURL') || has(data, 'PID')),
  read: data => {
    const entities = at(data, 'ImpactedEntities');
    return {
      title: str(data, 'ProblemTitle'),
      status: statusOf(str(data, 'State'), { merged: 'resolved' }),
      severity: lower(data, 'ProblemSeverity', 'SeverityLevel'),
      condition: str(data, 'ProblemImpact')
        ? `${humanKey(str(data, 'ProblemImpact')!.toLowerCase())} impact`
        : null,
      message: str(data, 'ProblemDetailsText', 'ProblemDetailsMarkdown'),
      where: fields(
        ['Problem', str(data, 'ProblemID')],
        [
          'Entities',
          (Array.isArray(entities) ? list(entities.map(e => str(e, 'name'))) : null) ??
            str(data, 'ImpactedEntity'),
        ]
      ),
      tags: splitTags(at(data, 'Tags')),
      links: links(['Open in Dynatrace', str(data, 'ProblemURL')]),
    };
  },
};

/** AppDynamics HTTP request template (the latestEvent / policy variables most templates send). */
export const appDynamics: SourceReader = {
  id: 'appdynamics',
  name: 'AppDynamics',
  detect: data =>
    isObj(data) &&
    (/^POLICY_(OPEN|CLOSE|CANCEL|CONTINUES|UPGRADED|DOWNGRADED)/.test(
      str(data, 'eventType') ?? ''
    ) ||
      (has(data, 'controllerUrl') && has(data, 'eventType'))),
  read: data => {
    const type = str(data, 'eventType') ?? '';
    const entity = [str(data, 'affectedEntityType'), str(data, 'affectedEntityName')]
      .filter(Boolean)
      .join(': ');
    return {
      title: str(data, 'healthRuleName', 'healthRule', 'displayName', 'eventName'),
      status: /CLOSE|CANCEL/.test(type)
        ? 'resolved'
        : /^POLICY_/.test(type)
          ? 'firing'
          : statusOf(type),
      severity:
        /_(CRITICAL|WARNING)$/.exec(type)?.[1]?.toLowerCase() ??
        lower(data, 'severity', 'eventSeverity', 'topSeverity'),
      condition: str(data, 'displayName'),
      message: str(data, 'summary', 'summaryMessage', 'eventMessage'),
      where: fields(
        ['Application', str(data, 'applicationName', 'application')],
        ['Tier', str(data, 'tierName', 'tier')],
        ['Node', str(data, 'nodeName', 'node')],
        ['Entity', entity || null],
        ['Policy', str(data, 'policyName', 'policy')],
        ['Account', str(data, 'accountName')]
      ),
      when: times(['Started', str(data, 'eventTime')]),
      links: links(
        ['Open in AppDynamics', str(data, 'deepLink')],
        ['Controller', str(data, 'controllerUrl')]
      ),
    };
  },
};

const SIGNALFX_STATUS: Record<string, PayloadStatus> = {
  anomalous: 'firing',
  ok: 'resolved',
  'manually resolved': 'resolved',
  stopped: 'resolved',
};

/** Splunk Observability Cloud (SignalFx) detector webhook. */
export const splunkObservability: SourceReader = {
  id: 'splunk-observability',
  name: 'Splunk Observability',
  detect: data =>
    isObj(data) &&
    (has(data, 'sf_schema') ||
      (has(data, 'detectorId') &&
        (has(data, 'detectorUrl') || has(data, 'incidentId') || has(data, 'inputs')))),
  read: data => {
    const inputs = isObj(at(data, 'inputs')) ? Object.entries(at(data, 'inputs') as Obj) : [];
    // The signal input carries its series `key`; `_S…` inputs are the detector's thresholds.
    const signal = inputs.find(([, v]) => isObj(at(v, 'key')));
    const threshold = inputs.find(([k]) => k.startsWith('_S'));
    const value = signal ? str(signal[1], 'value') : null;
    return {
      title: str(data, 'messageTitle') ?? str(data, 'detector', 'detectorName'),
      status: statusOf(str(data, 'status', 'statusExtended'), SIGNALFX_STATUS),
      severity: lower(data, 'severity'),
      condition: str(data, 'rule') ?? str(data, 'description'),
      measured: value ? { value, threshold: threshold ? str(threshold[1], 'value') : null } : null,
      query: str(signal?.[1], 'fragment')
        ? { language: 'SignalFlow', text: str(signal![1], 'fragment')! }
        : null,
      message: str(data, 'messageBody', 'description'),
      where: fields(
        ['Detector', str(data, 'detector', 'detectorName')],
        ['Metric', str(data, 'originatingMetric')]
      ),
      tags: labelTags(at(data, 'dimensions') ?? at(signal?.[1], 'key'), ['sf_metric']),
      when: times(['Started', str(data, 'timestamp')]),
      links: links(
        ['Open detector', str(data, 'detectorUrl')],
        ['Runbook', str(data, 'runbookUrl')]
      ),
      images: str(data, 'imageUrl') ? [str(data, 'imageUrl')!] : [],
    };
  },
};

/** Splunk Enterprise / Cloud saved-search alert webhook (`search_name`, `result`, `results_link`). */
export const splunk: SourceReader = {
  id: 'splunk',
  name: 'Splunk',
  detect: data =>
    isObj(data) && has(data, 'search_name') && (has(data, 'sid') || has(data, 'results_link')),
  read: data => ({
    title: str(data, 'search_name'),
    // Splunk only calls the webhook when the search triggers.
    status: 'firing',
    where: fields(['App', str(data, 'app')], ['Owner', str(data, 'owner')]),
    links: links(['Open results in Splunk', str(data, 'results_link')]),
  }),
};

/** Elastic / Kibana alerting webhook connector, with the {{rule.*}} / {{alert.*}} / {{context.*}} variables. */
export const elastic: SourceReader = {
  id: 'elastic',
  name: 'Elastic',
  detect: data =>
    isObj(data) &&
    isObj(data.rule) &&
    has(data, 'rule.name') &&
    (has(data, 'alert.actionGroup') ||
      has(data, 'alert.uuid') ||
      has(data, 'kibanaBaseUrl') ||
      has(data, 'context.alertDetailsUrl') ||
      has(data, 'context.viewInAppUrl') ||
      has(data, 'rule.spaceId')),
  read: data => {
    const group = lower(data, 'alert.actionGroup');
    const value = str(data, 'context.value');
    const threshold = at(data, 'context.threshold');
    return {
      title: str(data, 'rule.name') ?? str(data, 'context.title'),
      status:
        group === 'recovered'
          ? 'resolved'
          : (statusOf(str(data, 'alert.status'), { active: 'firing', recovered: 'resolved' }) ??
            (group ? 'firing' : null)),
      severity: lower(data, 'alert.severity', 'context.severity'),
      condition: str(data, 'context.conditions') ?? str(data, 'alert.actionGroupName'),
      measured: value
        ? {
            value,
            threshold: Array.isArray(threshold) ? list(threshold) : str(data, 'context.threshold'),
          }
        : null,
      message: str(data, 'context.reason', 'context.message'),
      where: fields(
        ['Group', str(data, 'context.group')],
        ['Rule type', str(data, 'rule.type')],
        ['Space', str(data, 'rule.spaceId')]
      ),
      tags: splitTags(at(data, 'rule.tags')),
      when: times(['Started', str(data, 'date')]),
      links: links(
        ['Alert details', str(data, 'context.alertDetailsUrl')],
        ['Open in Kibana', str(data, 'context.viewInAppUrl', 'context.link')],
        ['Rule', str(data, 'rule.url')]
      ),
    };
  },
};

/** Honeycomb trigger webhook (the default trigger template). */
export const honeycomb: SourceReader = {
  id: 'honeycomb',
  name: 'Honeycomb',
  detect: data =>
    isObj(data) &&
    (/honeycomb\.io/.test(str(data, 'result_url', 'trigger_url') ?? '') ||
      Array.isArray(data.result_groups_triggered) ||
      (has(data, 'trigger_description') && has(data, 'threshold'))),
  read: data => {
    const triggered = at(data, 'result_groups_triggered.0') ?? at(data, 'result_groups.0');
    const op = str(data, 'threshold.Op', 'operator');
    const limit = str(data, 'threshold.Value', 'threshold');
    const value = str(triggered, 'Result');
    return {
      title: str(data, 'name', 'alert_name'),
      status: statusOf(str(data, 'status')),
      severity: lower(data, 'alert_severity'),
      condition: str(data, 'description', 'summary'),
      measured: value
        ? { value, threshold: limit ? [op, limit].filter(Boolean).join(' ') : null }
        : null,
      message: str(data, 'trigger_description'),
      where: objFields(at(triggered, 'Group')),
      links: links(
        ['Query results', str(data, 'result_url')],
        ['Trigger', str(data, 'trigger_url')]
      ),
    };
  },
};

/** Sumo Logic keys are whatever the connection template names them; match the variable names, any case. */
function sumoKeys(data: unknown): Obj {
  return isObj(data)
    ? Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]/g, ''), v])
      )
    : {};
}

/** Sumo Logic monitor / scheduled-search webhook ({{TriggerType}}, {{Query}}, {{AlertResponseUrl}}…). */
export const sumoLogic: SourceReader = {
  id: 'sumologic',
  name: 'Sumo Logic',
  detect: data => {
    const m = sumoKeys(data);
    return (
      (has(m, 'triggertype') &&
        (has(m, 'detectionmethod') ||
          has(m, 'monitortype') ||
          has(m, 'alertresponseurl') ||
          has(m, 'queryurl'))) ||
      (has(m, 'searchname') && (has(m, 'searchqueryurl') || has(m, 'searchquery'))) ||
      /sumologic\.(com|net)/.test(str(m, 'alertresponseurl', 'queryurl', 'searchqueryurl') ?? '')
    );
  },
  read: data => {
    const m = sumoKeys(data);
    const trigger = str(m, 'triggertype') ?? '';
    const query = str(m, 'query', 'searchquery');
    const value = str(m, 'triggervalue');
    return {
      title: str(m, 'name', 'searchname', 'alertname'),
      status: /^resolved|^normal$/i.test(trigger) ? 'resolved' : trigger ? 'firing' : null,
      // "ResolvedMissingData" → "missing data"; Normal carries no level.
      severity: /^normal$/i.test(trigger)
        ? null
        : humanKey(trigger.replace(/^resolved/i, '')).toLowerCase() || null,
      condition: str(m, 'triggercondition', 'alertcondition'),
      measured: value ? { value, threshold: str(m, 'alertthreshold') } : null,
      query: query ? { language: 'Sumo Logic', text: query } : null,
      message: str(m, 'description', 'searchdescription'),
      where: fields(
        ['Monitor type', str(m, 'monitortype')],
        ['Detection', str(m, 'detectionmethod')],
        ['Results', str(m, 'numqueryresults', 'numrawresults')]
      ),
      when: times(['Started', str(m, 'triggertime', 'firetime', 'triggertimestart')]),
      links: links(
        ['Alert response', str(m, 'alertresponseurl')],
        ['Open query', str(m, 'queryurl', 'searchqueryurl')],
        ['Monitor', str(m, 'sourceurl')]
      ),
    };
  },
};

/** Coralogix generic outbound webhook (the default body: alert_id, alert_action, fields[] …). */
export const coralogix: SourceReader = {
  id: 'coralogix',
  name: 'Coralogix',
  detect: data =>
    isObj(data) &&
    has(data, 'alert_id', 'alert_action') &&
    (/coralogix/.test(str(data, 'alert_url', 'log_url', 'icon_url') ?? '') ||
      (Array.isArray(data.fields) && has(data, 'fields.0.key'))),
  read: data => {
    const extra = Array.isArray(at(data, 'fields')) ? (at(data, 'fields') as unknown[]) : [];
    const field = (key: string) =>
      str(
        extra.find(f => str(f, 'key') === key),
        'value'
      );
    const threshold = str(data, 'threshold');
    const window = str(data, 'timewindow');
    return {
      title: str(data, 'name', 'alert_name'),
      status: statusOf(str(data, 'alert_action')),
      severity: field('severity')?.toLowerCase() ?? lower(data, 'alert_severity'),
      condition: threshold ? `threshold ${threshold}${window ? ` in ${window} min` : ''}` : null,
      message: str(data, 'description'),
      where: fields(
        ['Application', field('application') ?? str(data, 'application')],
        ['Subsystem', field('subsystem') ?? str(data, 'subsystem')],
        ['Host', field('computer')],
        ['Service', str(data, 'service')],
        ['Group by', str(data, 'group_by_labels')]
      ),
      tags: extra
        .map(f => [str(f, 'key'), str(f, 'value')])
        .filter(
          ([k, v]) => k && v && !['severity', 'application', 'subsystem', 'computer'].includes(k)
        )
        .map(([k, v]) => `${k}:${v}`),
      links: links(['Open in Coralogix', str(data, 'alert_url')], ['Logs', str(data, 'log_url')]),
    };
  },
};

/** ServiceNow Cloud Observability (Lightstep) default webhook payload. */
export const lightstep: SourceReader = {
  id: 'lightstep',
  name: 'ServiceNow Cloud Observability',
  detect: data =>
    isObj(data) &&
    (has(data, 'metric-condition.href') ||
      (has(data, 'incident_id', 'project.href') && isObj(data.details))),
  read: data => {
    const status = str(data, 'status') ?? '';
    const d = at(data, 'details');
    const labels = at(d, 'Labels');
    const value = str(d, 'Actual Value');
    return {
      title: str(data, 'name') ?? str(data, 'title'),
      status: /no longer|resolved|^ok/i.test(status)
        ? 'resolved'
        : /violated|no data/i.test(status)
          ? 'firing'
          : statusOf(status),
      severity: /^(critical|warning)\b/i.exec(status)?.[1]?.toLowerCase() ?? null,
      condition: str(d, 'Expression') ?? str(data, 'metric-condition.text'),
      measured: value ? { value, threshold: null } : null,
      query: str(d, 'Query') ? { language: null, text: str(d, 'Query')! } : null,
      message: str(d, 'Description'),
      where: fields(['Project', str(data, 'project.text')], ['Service', str(d, 'Service')]),
      tags: isObj(labels) ? labelTags(labels) : splitTags(labels),
      when: times(['Started', str(d, 'Started At')], ['Last update', str(data, 'timestamp')]),
      links: links(
        ['Open alert', str(data, 'metric-condition.href')],
        ['Project', str(data, 'project.href')],
        ['Exemplar trace', str(d, 'Exemplars.0.href')]
      ),
    };
  },
};

/** SigNoz alert webhook: Alertmanager-shaped, recognised by SigNoz's own ruleId / ruleSource labels. */
export const signoz: SourceReader = {
  id: 'signoz',
  name: 'SigNoz',
  detect: data =>
    isObj(data) &&
    Array.isArray(data.alerts) &&
    has(data, 'alerts.0.labels.ruleId') &&
    (has(data, 'alerts.0.labels.ruleSource') ||
      /ruleId=/.test(str(data, 'alerts.0.generatorURL') ?? '')),
  read: data => {
    const base = alertmanager.read(data);
    const first = at(data, 'alerts.0');
    return {
      ...base,
      tags: labelTags(at(first, 'labels'), ['alertname', 'severity', 'ruleId', 'ruleSource']),
      links: links(
        ['Open rule in SigNoz', str(first, 'labels.ruleSource') ?? str(first, 'generatorURL')],
        ['Related logs', str(first, 'annotations.related_logs')],
        ['Related traces', str(first, 'annotations.related_traces')]
      ),
    };
  },
};

/** Chronosphere webhook notifier: Alertmanager-shaped, with a top-level `notifier` and monitor annotations. */
export const chronosphere: SourceReader = {
  id: 'chronosphere',
  name: 'Chronosphere',
  detect: data =>
    isObj(data) &&
    Array.isArray(data.alerts) &&
    has(data, 'notifier') &&
    (has(data, 'alerts.0.annotations.monitor_slug') ||
      has(data, 'alerts.0.annotations.notification_policy_slug')),
  read: data => {
    const base = alertmanager.read(data);
    return {
      ...base,
      where: fields(
        ['Monitor', str(data, 'alerts.0.annotations.monitor_slug')],
        ['Notification policy', str(data, 'alerts.0.annotations.notification_policy_slug')],
        ['Notifier', str(data, 'notifier')]
      ),
    };
  },
};

/**
 * Most specific first. CloudWatch and Health before the generic EventBridge envelope; SigNoz and Chronosphere
 * only claim Alertmanager-shaped payloads that carry their own labels / annotations.
 */
export const CLOUD_READERS: SourceReader[] = [
  awsCloudWatch,
  awsHealth,
  awsEventBridge,
  azureMonitor,
  googleCloudMonitoring,
  newRelic,
  dynatrace,
  appDynamics,
  splunkObservability,
  splunk,
  elastic,
  honeycomb,
  sumoLogic,
  coralogix,
  lightstep,
  signoz,
  chronosphere,
];

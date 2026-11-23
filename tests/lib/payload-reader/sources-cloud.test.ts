import { describe, expect, it } from 'vitest';
import { readPayload } from '@/lib/payload-reader';
import { parseAny } from '@/lib/payload-reader/formats';
import { CLOUD_READERS } from '@/lib/payload-reader/sources/cloud';

/* Fixtures follow each vendor's documented example payload, with fake values only. */

const cloudWatchAlarm = {
  AlarmName: 'api-cpu-high',
  AlarmDescription: 'CPU above 80% on the API fleet',
  AWSAccountId: '123456789012',
  AlarmConfigurationUpdatedTimestamp: '2026-11-20T08:00:00.000+0000',
  NewStateValue: 'ALARM',
  NewStateReason:
    'Threshold Crossed: 1 out of the last 1 datapoints [85.5 (23/11/26 10:00:00)] was greater than the threshold (80.0) (minimum 1 datapoint for OK -> ALARM transition).',
  StateChangeTime: '2026-11-23T10:05:00.000+0000',
  Region: 'US East (N. Virginia)',
  AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:api-cpu-high',
  OldStateValue: 'OK',
  Trigger: {
    MetricName: 'CPUUtilization',
    Namespace: 'AWS/EC2',
    StatisticType: 'Statistic',
    Statistic: 'AVERAGE',
    Unit: null,
    Dimensions: [{ value: 'i-0abc123def4567890', name: 'InstanceId' }],
    Period: 300,
    EvaluationPeriods: 1,
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 80.0,
    TreatMissingData: 'missing',
  },
};

const cloudWatchSns = {
  Type: 'Notification',
  MessageId: 'b3f1c2d4-0000-4000-8000-000000000001',
  TopicArn: 'arn:aws:sns:us-east-1:123456789012:opsknight-alarms',
  Subject: 'ALARM: "api-cpu-high" in US East (N. Virginia)',
  Message: JSON.stringify(cloudWatchAlarm),
  Timestamp: '2026-11-23T10:05:01.000Z',
  SignatureVersion: '1',
  Signature: 'ZmFrZQ==',
  SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
  UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe',
};

const cloudWatchEventBridge = {
  version: '0',
  id: 'c4c1c1c9-6542-e61b-6ef0-8c4d36933a92',
  'detail-type': 'CloudWatch Alarm State Change',
  source: 'aws.cloudwatch',
  account: '123456789012',
  time: '2026-11-23T10:05:00Z',
  region: 'eu-west-1',
  resources: ['arn:aws:cloudwatch:eu-west-1:123456789012:alarm:queue-depth'],
  detail: {
    alarmName: 'queue-depth',
    state: {
      value: 'OK',
      reason: 'Threshold Crossed: 1 datapoint [12.0] was not greater than the threshold (100.0).',
      reasonData:
        '{"version":"1.0","queryDate":"2026-11-23T10:05:00.000+0000","statistic":"Maximum","period":60,"recentDatapoints":[12.0],"threshold":100.0}',
      timestamp: '2026-11-23T10:05:00.000+0000',
    },
    previousState: { value: 'ALARM' },
    configuration: {
      description: 'Orders queue backing up',
      metrics: [
        {
          id: 'm1',
          metricStat: {
            metric: {
              namespace: 'AWS/SQS',
              name: 'ApproximateNumberOfMessagesVisible',
              dimensions: { QueueName: 'orders' },
            },
            period: 60,
            stat: 'Maximum',
          },
          returnData: true,
        },
      ],
    },
  },
};

const awsHealthEvent = {
  version: '0',
  id: '7bf73129-1428-4cd3-a780-95db273d1602',
  'detail-type': 'AWS Health Event',
  source: 'aws.health',
  account: '123456789012',
  time: '2026-11-23T09:01:22Z',
  region: 'af-south-1',
  resources: [],
  detail: {
    eventArn:
      'arn:aws:health:af-south-1::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/AWS_EC2_OPERATIONAL_ISSUE_7f35c8ae',
    service: 'EC2',
    eventTypeCode: 'AWS_EC2_OPERATIONAL_ISSUE',
    eventTypeCategory: 'issue',
    eventScopeCode: 'PUBLIC',
    startTime: 'Mon, 23 Nov 2026 06:02:51 GMT',
    lastUpdatedTime: 'Mon, 23 Nov 2026 09:01:22 GMT',
    statusCode: 'open',
    eventRegion: 'af-south-1',
    eventDescription: [
      { language: 'en_US', latestDescription: 'We are investigating increased API error rates.' },
    ],
  },
};

const guardDutyFinding = {
  version: '0',
  id: 'cd2d702e-ab31-411b-9344-793ce56b1bc7',
  'detail-type': 'GuardDuty Finding',
  source: 'aws.guardduty',
  account: '123456789012',
  time: '2026-11-23T11:00:00Z',
  region: 'us-east-1',
  resources: [],
  detail: {
    schemaVersion: '2.0',
    accountId: '123456789012',
    region: 'us-east-1',
    type: 'Recon:EC2/PortProbeUnprotectedPort',
    severity: 7.5,
    title: 'Unprotected port on EC2 instance i-0abc is being probed.',
    description:
      'EC2 instance has an unprotected port which is being probed by a known malicious host.',
  },
};

const azureCommonMetric = {
  schemaId: 'azureMonitorCommonAlertSchema',
  data: {
    essentials: {
      alertId:
        '/subscriptions/11111111-2222-3333-4444-555555555555/providers/Microsoft.AlertsManagement/alerts/b9569717-bc32-442f-add5-83a997729330',
      alertRule: 'vm-cpu-high',
      severity: 'Sev2',
      signalType: 'Metric',
      monitorCondition: 'Fired',
      monitoringService: 'Platform',
      alertTargetIDs: [
        '/subscriptions/11111111-2222-3333-4444-555555555555/resourcegroups/rg-prod/providers/microsoft.compute/virtualmachines/vm-web-01',
      ],
      configurationItems: ['vm-web-01'],
      originAlertId:
        '3f2d4487-b0fc-4125-8bd5-7ad17384221e_PipeLineAlertRG_microsoft.insights_metricAlerts_vm-cpu-high',
      firedDateTime: '2026-11-23T10:00:24.123Z',
      description: 'CPU above 80% on web VM',
      essentialsVersion: '1.0',
      alertContextVersion: '1.0',
      targetResourceType: 'microsoft.compute/virtualmachines',
      targetResourceGroup: 'rg-prod',
    },
    alertContext: {
      properties: null,
      conditionType: 'SingleResourceMultipleMetricCriteria',
      condition: {
        windowSize: 'PT5M',
        allOf: [
          {
            metricName: 'Percentage CPU',
            metricNamespace: 'Microsoft.Compute/virtualMachines',
            operator: 'GreaterThan',
            threshold: '80',
            timeAggregation: 'Average',
            dimensions: [{ name: 'ResourceId', value: 'vm-web-01' }],
            metricValue: 91.4,
          },
        ],
      },
    },
    customProperties: { team: 'web' },
  },
};

const azureCommonLog = {
  schemaId: 'azureMonitorCommonAlertSchema',
  data: {
    essentials: {
      alertId:
        '/subscriptions/11111111-2222-3333-4444-555555555555/providers/Microsoft.AlertsManagement/alerts/aa11',
      alertRule: 'checkout-errors',
      severity: 'Sev1',
      signalType: 'Log',
      monitorCondition: 'Resolved',
      monitoringService: 'Log Alerts V2',
      alertTargetIDs: [
        '/subscriptions/11111111-2222-3333-4444-555555555555/resourcegroups/rg-prod/providers/microsoft.operationalinsights/workspaces/law-prod',
      ],
      configurationItems: ['law-prod'],
      firedDateTime: '2026-11-23T09:00:00Z',
      resolvedDateTime: '2026-11-23T09:30:00Z',
    },
    alertContext: {
      conditionType: 'LogQueryCriteria',
      condition: {
        windowSize: 'PT10M',
        allOf: [
          {
            searchQuery: 'AppExceptions | where AppRoleName == "checkout" | summarize count()',
            metricMeasureColumn: null,
            targetResourceTypes: "['Microsoft.OperationalInsights/workspaces']",
            operator: 'GreaterThan',
            threshold: '10',
            timeAggregation: 'Count',
            metricValue: 3,
            linkToFilteredSearchResultsUI:
              'https://portal.azure.com#@tenant/blade/Microsoft_Azure_Monitoring_Logs/LogsBlade/q/abc',
          },
        ],
      },
    },
  },
};

const azureLegacyMetric = {
  schemaId: 'AzureMonitorMetricAlert',
  data: {
    version: '2.0',
    status: 'Activated',
    context: {
      timestamp: '2026-11-23T10:00:00Z',
      id: '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/microsoft.insights/metricAlerts/db-dtu',
      name: 'db-dtu',
      description: 'DTU high',
      conditionType: 'SingleResourceMultipleMetricCriteria',
      severity: '3',
      condition: {
        windowSize: 'PT5M',
        allOf: [
          {
            metricName: 'dtu_consumption_percent',
            operator: 'GreaterThan',
            threshold: '90',
            timeAggregation: 'Average',
            metricValue: 97,
          },
        ],
      },
      subscriptionId: '11111111-2222-3333-4444-555555555555',
      resourceGroupName: 'rg-prod',
      resourceName: 'sqldb-orders',
      resourceType: 'Microsoft.Sql/servers/databases',
      resourceId:
        '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql1/databases/sqldb-orders',
      portalLink: 'https://portal.azure.com/#resource/subscriptions/1111/resourceGroups/rg-prod',
    },
    properties: {},
  },
};

const gcpIncident = {
  version: '1.2',
  incident: {
    incident_id: '0.opqiw61fsv7p',
    scoping_project_id: 'acme-prod',
    scoping_project_number: 12345,
    url: 'https://console.cloud.google.com/monitoring/alerting/incidents/0.opqiw61fsv7p?project=acme-prod',
    severity: 'Critical',
    started_at: 1763892000,
    ended_at: null,
    state: 'open',
    summary: 'CPU utilization for gke-node-1 is above the threshold of 0.8 with a value of 0.966.',
    apigee_url: 'https://apigee.google.com',
    observed_value: '0.966',
    resource: {
      type: 'gce_instance',
      labels: { instance_id: '1234567890', project_id: 'acme-prod', zone: 'us-central1-a' },
    },
    resource_type_display_name: 'VM Instance',
    resource_display_name: 'gke-node-1',
    resource_name: 'projects/acme-prod/zones/us-central1-a/instances/gke-node-1',
    metric: {
      type: 'compute.googleapis.com/instance/cpu/utilization',
      displayName: 'CPU utilization',
      labels: { instance_name: 'gke-node-1' },
    },
    metadata: { system_labels: {}, user_labels: { team: 'platform' } },
    policy_name: 'GKE node CPU',
    policy_user_labels: { env: 'prod' },
    documentation: {
      content: 'Check the node pool autoscaler.',
      mime_type: 'text/markdown',
      subject: 'GKE node CPU',
      links: [{ displayName: 'Playbook', url: 'https://wiki.example.com/gke-cpu' }],
    },
    condition: {
      name: 'projects/acme-prod/alertPolicies/123/conditions/456',
      displayName: 'VM Instance - CPU utilization',
      conditionThreshold: {
        filter:
          'resource.type = "gce_instance" AND metric.type = "compute.googleapis.com/instance/cpu/utilization"',
        comparison: 'COMPARISON_GT',
        thresholdValue: 0.8,
        duration: '0s',
      },
    },
    condition_name: 'VM Instance - CPU utilization',
    threshold_value: '0.8',
  },
};

const newRelicWorkflow = {
  id: 'f8d3a1b2-0000-4000-8000-000000000002',
  issueUrl:
    'https://radar-api.service.newrelic.com/accounts/1234567/issues/f8d3a1b2?notifier=WEBHOOK',
  title: 'checkout-api query result is > 5.0 for 5 minutes',
  priority: 'CRITICAL',
  impactedEntities: ['checkout-api'],
  totalIncidents: 1,
  state: 'ACTIVATED',
  trigger: 'STATE_CHANGE',
  isCorrelated: false,
  createdAt: 1763892000000,
  updatedAt: 1763892060000,
  sources: ['newrelic'],
  alertPolicyNames: ['Checkout golden signals'],
  alertConditionNames: ['Error rate high'],
  workflowName: 'opsknight',
};

const newRelicLegacy = {
  account_id: 1234567,
  account_name: 'Acme',
  closed_violations_count: { critical: 0, warning: 0 },
  condition_family_id: 77,
  condition_id: 88,
  condition_name: 'Host CPU high',
  current_state: 'open',
  details: "CPU % > 90.0 for at least 5 minutes on 'web-1'",
  duration: 5,
  event_type: 'INCIDENT',
  incident_acknowledge_url: 'https://alerts.newrelic.com/accounts/1234567/incidents/42/acknowledge',
  incident_id: 42,
  incident_url: 'https://alerts.newrelic.com/accounts/1234567/incidents/42',
  open_violations_count: { critical: 1, warning: 0 },
  owner: '',
  policy_name: 'Infra',
  policy_url: 'https://alerts.newrelic.com/accounts/1234567/policies/9',
  runbook_url: 'https://wiki.example.com/rb/cpu',
  severity: 'CRITICAL',
  targets: [
    {
      id: '555',
      name: 'web-1',
      link: 'https://infrastructure.newrelic.com/accounts/1234567/hosts/555',
      labels: { role: 'web' },
      product: 'INFRASTRUCTURE',
      type: 'Host',
    },
  ],
  timestamp: 1763892000000,
  violation_chart_url: 'https://gorgon.nr-assets.net/image/abc?config.legend.enabled=false',
};

const dynatraceProblem = {
  ImpactedEntities: [{ type: 'SERVICE', name: 'checkout-service', entity: 'SERVICE-1234' }],
  ImpactedEntity: 'checkout-service',
  PID: '-1234567890_1763892000000V2',
  ProblemDetailsText: 'Failure rate increase on checkout-service: 12% (baseline 1%).',
  ProblemID: 'P-2611231',
  ProblemImpact: 'SERVICE',
  ProblemSeverity: 'ERROR',
  ProblemTitle: 'Failure rate increase',
  ProblemURL:
    'https://abc12345.live.dynatrace.com/#problems/problemdetails;pid=-1234567890_1763892000000V2',
  State: 'OPEN',
  Tags: 'env:prod, team:payments',
};

const appDynamicsEvent = {
  controllerUrl: 'https://acme.saas.appdynamics.com/controller',
  accountName: 'acme',
  policy: 'Checkout policy',
  action: 'opsknight-webhook',
  eventType: 'POLICY_OPEN_CRITICAL',
  eventId: 9912,
  displayName: 'Health Rule Violation Started - Critical',
  eventTime: '2026-11-23T10:00:00Z',
  severity: 'ERROR',
  application: 'checkout',
  tier: 'api',
  node: 'api-node-1',
  deepLink:
    'https://acme.saas.appdynamics.com/controller/#location=APP_INCIDENT_DETAIL&incident=9912',
  summary: 'Business Transaction /checkout response time is too high and is now critical.',
  healthRuleName: 'BT response time',
  affectedEntityType: 'BUSINESS_TRANSACTION',
  affectedEntityName: '/checkout',
};

const splunkSearch = {
  result: { sourcetype: 'access_combined', status: '500', count: '84' },
  sid: 'scheduler__admin__search__RMD5f0a_at_1763892000_123',
  results_link:
    'https://splunk.example.com:8000/app/search/@go?sid=scheduler__admin__search__RMD5f0a',
  search_name: 'Checkout 5xx spike',
  owner: 'admin',
  app: 'search',
};

const signalFxDetector = {
  description: 'The value of cpu.utilization is above 90.',
  detector: 'Host CPU',
  detectorId: 'DxYz123AAAA',
  detectorUrl: 'https://app.us1.signalfx.com/#/detector/v2/DxYz123AAAA/edit',
  eventType: 'DxYz123AAAA__ruleA__host:web-1',
  imageUrl: 'https://static.signalfx.com/chart/abc.png',
  incidentId: 'FaB9876',
  inputs: {
    A: {
      key: { host: 'web-1', sf_metric: 'cpu.utilization' },
      value: '97.2',
      fragment: "data('cpu.utilization').publish(label='A')",
    },
    _S2: { value: '90' },
  },
  messageBody: 'CPU on web-1 is 97.2%.',
  messageTitle: 'Critical Alert: Host CPU (CPU above 90)',
  originatingMetric: 'cpu.utilization',
  rule: 'CPU above 90',
  runbookUrl: 'https://wiki.example.com/rb/cpu',
  severity: 'Critical',
  sf_schema: 2,
  status: 'anomalous',
  statusExtended: 'anomalous',
  timestamp: '2026-11-23T10:00:00Z',
  dimensions: { host: 'web-1', sf_metric: 'cpu.utilization' },
};

const kibanaAlert = {
  rule: {
    id: '9b3c9c50-0000-4000-8000-000000000003',
    name: 'High CPU on hosts',
    type: 'metrics.alert.threshold',
    spaceId: 'default',
    tags: ['infra', 'prod'],
    url: 'https://kibana.example.com/app/observability/alerts/rules/9b3c9c50',
  },
  alert: {
    id: 'web-1',
    uuid: 'a1b2c3d4-0000-4000-8000-000000000004',
    actionGroup: 'metrics.threshold.fired',
    actionGroupName: 'Alert',
  },
  context: {
    reason: 'system.cpu.total.norm.pct is 92.3% in the last 5 mins for web-1. Alert when > 90%.',
    value: '92.3%',
    threshold: ['90%'],
    group: 'web-1',
    alertDetailsUrl: 'https://kibana.example.com/app/observability/alerts/a1b2c3d4',
    viewInAppUrl: 'https://kibana.example.com/app/metrics/explorer',
  },
  date: '2026-11-23T10:00:00.000Z',
  kibanaBaseUrl: 'https://kibana.example.com',
};

const honeycombTrigger = {
  version: 'v0.1.0',
  shared_secret: 'not-a-real-secret',
  id: '2Ab3cDe4fGh',
  name: 'Checkout latency P99',
  trigger_description: 'P99 of checkout requests',
  trigger_url:
    'https://ui.honeycomb.io/acme/environments/prod/datasets/checkout/triggers/2Ab3cDe4fGh',
  status: 'TRIGGERED',
  summary: 'Triggered: Checkout latency P99',
  description: 'Currently greater than threshold value (1500) for P99(duration_ms)',
  operator: 'greater than',
  threshold: { Op: '>', Value: 1500 },
  result_url: 'https://ui.honeycomb.io/acme/environments/prod/datasets/checkout/result/xyz',
  result_groups: [{ Group: { 'service.name': 'checkout' }, Result: 2140 }],
  result_groups_triggered: [{ Group: { 'service.name': 'checkout' }, Result: 2140 }],
  is_test: false,
};

const sumoMonitor = {
  Name: 'Login failures spike',
  Description: 'Too many failed logins',
  MonitorType: 'Logs',
  Query: '_sourceCategory=auth "login failed" | count',
  QueryURL: 'https://service.sumologic.com/ui/#/search/abc',
  NumQueryResults: 1,
  Id: '0000000000ABCDEF',
  DetectionMethod: 'LogsStaticCondition',
  TriggerType: 'Critical',
  TriggerTimeRange: '-15m',
  TriggerTime: '2026-11-23T10:00:00Z',
  TriggerCondition: 'Greater than or equal to 100',
  TriggerValue: 342,
  AlertResponseUrl: 'https://service.sumologic.com/ui/#/alert/123',
};

const coralogixAlert = {
  uuid: 'c0ffee00-0000-4000-8000-000000000005',
  alert_id: 'b1e2c3d4-0000-4000-8000-000000000006',
  name: 'Payment errors',
  description: 'More than 50 payment errors in 10 minutes',
  threshold: '50',
  timewindow: '10',
  group_by_labels: 'region',
  alert_action: 'trigger',
  alert_url: 'https://acme.app.coralogix.com/#/insights?id=b1e2c3d4',
  log_url: 'https://acme.app.coralogix.com/#/query-new/logs?id=b1e2c3d4',
  icon_url: 'https://coralogix.com/wp-content/uploads/2021/01/coralogix-logo.png',
  service: 'payments',
  duration: '0',
  fields: [
    { key: 'severity', value: 'Error' },
    { key: 'computer', value: 'pay-1' },
    { key: 'application', value: 'payments' },
    { key: 'subsystem', value: 'api' },
    { key: 'team', value: 'billing' },
  ],
};

const lightstepAlert = {
  timestamp: '2026-11-23T10:00:00Z',
  title: 'Critical Threshold Violated: Checkout p99 latency',
  status: 'Critical Threshold Violated',
  name: 'Checkout p99 latency',
  incident_id: 'inc-7f2a',
  project: { text: 'acme-prod', href: 'https://app.lightstep.com/acme-prod' },
  'metric-condition': {
    text: 'Checkout p99 latency',
    href: 'https://app.lightstep.com/acme-prod/alerts/abc123',
  },
  details: {
    'Actual Value': '2410',
    Configuration: 'Critical: > 2000',
    Description: 'p99 latency above 2s',
    Labels: { team: 'payments' },
    Expression: 'p99 latency > 2000 ms',
    'Started At': '2026-11-23T09:58:00Z',
  },
};

const signozAlert = {
  receiver: 'opsknight',
  status: 'firing',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'Checkout error rate',
        ruleId: '42',
        ruleSource: 'https://signoz.example.com/alerts/edit?ruleId=42',
        severity: 'critical',
        service_name: 'checkout',
      },
      annotations: {
        summary: 'Checkout error rate above 5%',
        description: 'Error rate is 7.1% (threshold 5%)',
        related_logs: 'https://signoz.example.com/logs/logs-explorer?q=abc',
      },
      startsAt: '2026-11-23T10:00:00Z',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'https://signoz.example.com/alerts/edit?ruleId=42',
      fingerprint: 'f1e2d3c4b5a69788',
    },
  ],
  groupLabels: { alertname: 'Checkout error rate' },
  commonLabels: { alertname: 'Checkout error rate', severity: 'critical' },
  commonAnnotations: { summary: 'Checkout error rate above 5%' },
  externalURL: 'https://signoz.example.com',
  version: '4',
};

const chronosphereAlert = {
  notifier: 'opsknight webhook',
  status: 'firing',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'Pod restarts',
        severity: 'warn',
        pod_name: 'api-7d9f',
        instance: 'api-7d9f:8080',
      },
      annotations: {
        ruleid: 'pod-restarts',
        monitor_slug: 'pod-restarts',
        notification_policy_slug: 'platform-default',
      },
      startsAt: '2026-11-23T10:00:00Z',
      endsAt: '0001-01-01T00:00:00Z',
      fingerprint: 'abc123def456',
    },
  ],
  groupLabels: { alertname: 'Pod restarts', severity: 'warn' },
  commonLabels: { alertname: 'Pod restarts', severity: 'warn' },
  commonAnnotations: { monitor_slug: 'pod-restarts' },
  version: '4',
};

// The three core fixtures from payload-reader.test.ts.
const datadogCore = {
  id: '7349216650104451208',
  source: 'datadog',
  alert_type: 'error',
  title: '[Triggered] checkout 5xx rate above 5% on POST /v1/checkout',
  alert_transition: 'Triggered',
  monitor: { id: 8841213, name: 'checkout 5xx rate', priority: 'P1' },
  query: 'sum(last_5m):sum:trace.http.request.errors{service:checkout-api}.as_rate() > 0.05',
  value: 0.184,
  threshold: 0.05,
  tags: 'env:prod,service:checkout-api',
  link: 'https://app.datadoghq.com/monitors/8841213',
};
const alertmanagerCore = {
  receiver: 'opsknight',
  status: 'firing',
  alerts: [
    {
      status: 'firing',
      labels: {
        alertname: 'HighLatency',
        severity: 'critical',
        instance: 'api-1:9090',
        team: 'payments',
      },
      annotations: { summary: 'p99 above 2s', runbook_url: 'https://wiki/rb' },
      startsAt: '2026-11-22T15:27:00Z',
      endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'https://prom.example.com/graph?g0.expr=x',
    },
  ],
  groupLabels: { alertname: 'HighLatency' },
  commonLabels: { alertname: 'HighLatency', severity: 'critical' },
  commonAnnotations: { summary: 'p99 above 2s' },
  externalURL: 'https://am.example.com',
};
const grafanaCore = {
  orgId: 1,
  status: 'firing',
  title: '[FIRING:1] Slow queries',
  alerts: [
    {
      labels: { alertname: 'Slow queries', grafana_folder: 'db' },
      annotations: { description: 'host: db-1\nquery_duration_ms: 5400' },
      values: "{'A':5400,'B':1}",
      dashboardURL: 'https://g.example.com/d/1',
      fingerprint: 'abc',
    },
  ],
};

/** Every fixture and the reader that must claim it through readPayload. */
const ROUTED: Array<[string, unknown, string]> = [
  ['CloudWatch via SNS', cloudWatchSns, 'aws-cloudwatch'],
  ['CloudWatch raw alarm', cloudWatchAlarm, 'aws-cloudwatch'],
  ['CloudWatch via EventBridge', cloudWatchEventBridge, 'aws-cloudwatch'],
  ['AWS Health', awsHealthEvent, 'aws-health'],
  ['GuardDuty via EventBridge', guardDutyFinding, 'aws-eventbridge'],
  ['Azure common (metric)', azureCommonMetric, 'azure-monitor'],
  ['Azure common (log)', azureCommonLog, 'azure-monitor'],
  ['Azure legacy metric', azureLegacyMetric, 'azure-monitor'],
  ['Google Cloud Monitoring', gcpIncident, 'google-cloud-monitoring'],
  ['New Relic workflow', newRelicWorkflow, 'newrelic'],
  ['New Relic legacy', newRelicLegacy, 'newrelic'],
  ['Dynatrace', dynatraceProblem, 'dynatrace'],
  ['AppDynamics', appDynamicsEvent, 'appdynamics'],
  ['Splunk search', splunkSearch, 'splunk'],
  ['Splunk Observability', signalFxDetector, 'splunk-observability'],
  ['Kibana', kibanaAlert, 'elastic'],
  ['Honeycomb', honeycombTrigger, 'honeycomb'],
  ['Sumo Logic', sumoMonitor, 'sumologic'],
  ['Coralogix', coralogixAlert, 'coralogix'],
  ['Lightstep', lightstepAlert, 'lightstep'],
];

const reader = (id: string) => CLOUD_READERS.find(r => r.id === id)!;

describe('cloud source readers: routing', () => {
  it.each(ROUTED)('%s is read by its own reader', (_name, payload, id) => {
    expect(readPayload(payload).source?.id).toBe(id);
  });

  it('each fixture is detected by exactly one cloud reader', () => {
    const all: Array<[string, unknown, string]> = [
      ...ROUTED,
      ['SigNoz', signozAlert, 'signoz'],
      ['Chronosphere', chronosphereAlert, 'chronosphere'],
    ];
    for (const [name, payload, id] of all) {
      const { data } = parseAny(payload);
      const claims = CLOUD_READERS.filter(r => r.detect(data)).map(r => r.id);
      // These are also EventBridge-shaped; the order puts the specific reader first.
      const expected =
        id === 'aws-health' || name === 'CloudWatch via EventBridge'
          ? [id, 'aws-eventbridge']
          : [id];
      expect({ name, claims }).toEqual({ name, claims: expected });
    }
  });

  it('does not claim the core Datadog, Alertmanager and Grafana payloads', () => {
    for (const payload of [datadogCore, alertmanagerCore, grafanaCore]) {
      expect(CLOUD_READERS.filter(r => r.detect(payload))).toEqual([]);
    }
    expect(readPayload(datadogCore).source?.id).toBe('datadog');
    expect(readPayload(alertmanagerCore).source?.id).toBe('alertmanager');
    expect(readPayload(grafanaCore).source?.id).toBe('grafana');
  });

  it('never throws on odd shapes', () => {
    for (const odd of [
      null,
      'x',
      42,
      [],
      {},
      { Type: 'Notification', Message: 'x' },
      { alerts: 'x' },
    ]) {
      for (const r of CLOUD_READERS) expect(() => r.detect(odd)).not.toThrow();
    }
  });
});

describe('cloud source readers: fields', () => {
  it('reads a CloudWatch alarm from its SNS envelope', () => {
    const view = readPayload(JSON.stringify(cloudWatchSns));
    expect(view).toMatchObject({
      title: 'api-cpu-high',
      status: 'firing',
      measured: { value: '85.5', threshold: '80' },
      condition: 'AVERAGE CPUUtilization > 80 for 1 × 300s',
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Account', value: '123456789012' },
        { label: 'Region', value: 'US East (N. Virginia)' },
        { label: 'InstanceId', value: 'i-0abc123def4567890' },
      ])
    );
    expect(view.links[0]).toEqual({
      label: 'Open in CloudWatch',
      url: 'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:alarm/api-cpu-high',
    });
    expect(view.when[0]).toEqual({ label: 'Changed', at: '2026-11-23T10:05:00.000Z' });
  });

  it('reads a CloudWatch alarm state change from EventBridge', () => {
    const view = readPayload(cloudWatchEventBridge);
    expect(view).toMatchObject({
      title: 'queue-depth',
      status: 'resolved',
      measured: { value: '12', threshold: '100' },
      condition: 'Maximum AWS/SQS ApproximateNumberOfMessagesVisible',
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Region', value: 'eu-west-1' },
        { label: 'QueueName', value: 'orders' },
      ])
    );
    expect(view.links[0]?.url).toContain('eu-west-1.console.aws.amazon.com/cloudwatch');
  });

  it('reads an AWS Health event', () => {
    const view = readPayload(awsHealthEvent);
    expect(view).toMatchObject({
      title: 'EC2 operational issue',
      status: 'firing',
      message: 'We are investigating increased API error rates.',
    });
    expect(view.where).toContainEqual({ label: 'Region', value: 'af-south-1' });
    expect(view.when[0]).toEqual({ label: 'Started', at: '2026-11-23T06:02:51.000Z' });
  });

  it('reads any other EventBridge event, GuardDuty severity banded', () => {
    const view = readPayload(guardDutyFinding);
    expect(view).toMatchObject({
      title: 'Unprotected port on EC2 instance i-0abc is being probed.',
      severity: 'high',
      condition: 'Recon:EC2/PortProbeUnprotectedPort',
    });
    expect(view.where).toContainEqual({ label: 'Source', value: 'aws.guardduty' });
  });

  it('reads the Azure Common Alert Schema (metric)', () => {
    const view = readPayload(azureCommonMetric);
    expect(view).toMatchObject({
      title: 'vm-cpu-high',
      status: 'firing',
      severity: 'sev2',
      condition: 'Average Percentage CPU > 80 over PT5M',
      measured: { value: '91.4', threshold: '80' },
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Resource', value: 'vm-web-01' },
        { label: 'Resource group', value: 'rg-prod' },
        { label: 'Subscription', value: '11111111-2222-3333-4444-555555555555' },
      ])
    );
    expect(view.links[0]?.label).toBe('Open in Azure');
    expect(view.links[0]?.url).toMatch(/^https:\/\/portal\.azure\.com\//);
    expect(view.tags).toContain('team:web');
  });

  it('reads an Azure log search alert, resolved, with its KQL', () => {
    const view = readPayload(azureCommonLog);
    expect(view).toMatchObject({
      status: 'resolved',
      severity: 'sev1',
      query: { language: 'KQL' },
      measured: { value: '3', threshold: '10' },
    });
    expect(view.links.map(l => l.label)).toContain('Log results');
    expect(view.when.map(t => t.label)).toEqual(expect.arrayContaining(['Started', 'Resolved']));
  });

  it('reads a legacy Azure metric alert', () => {
    const view = readPayload(azureLegacyMetric);
    expect(view).toMatchObject({
      title: 'db-dtu',
      status: 'firing',
      severity: 'sev3',
      measured: { value: '97', threshold: '90' },
    });
    expect(view.where).toContainEqual({ label: 'Resource', value: 'sqldb-orders' });
  });

  it('reads a Google Cloud Monitoring incident', () => {
    const view = readPayload(gcpIncident);
    expect(view).toMatchObject({
      title: 'GKE node CPU',
      status: 'firing',
      severity: 'critical',
      condition: 'VM Instance - CPU utilization',
      measured: { value: '0.966', threshold: '0.8' },
      query: { language: 'Monitoring filter' },
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Project', value: 'acme-prod' },
        { label: 'Resource', value: 'gke-node-1' },
        { label: 'Zone', value: 'us-central1-a' },
      ])
    );
    expect(view.links.map(l => l.label).slice(0, 2)).toEqual([
      'Open in Cloud Monitoring',
      'Playbook',
    ]);
    expect(view.when[0]).toEqual({
      label: 'Started',
      at: new Date(1763892000 * 1000).toISOString(),
    });
    expect(view.tags).toEqual(expect.arrayContaining(['env:prod', 'team:platform']));
  });

  it('reads a New Relic workflow issue', () => {
    const view = readPayload(newRelicWorkflow);
    expect(view).toMatchObject({
      title: 'checkout-api query result is > 5.0 for 5 minutes',
      status: 'firing',
      severity: 'critical',
      condition: 'Error rate high',
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Policy', value: 'Checkout golden signals' },
        { label: 'Entities', value: 'checkout-api' },
      ])
    );
    expect(view.links[0]?.label).toBe('Open in New Relic');
  });

  it('reads a legacy New Relic alert', () => {
    const view = readPayload(newRelicLegacy);
    expect(view).toMatchObject({
      title: 'Host CPU high',
      status: 'firing',
      severity: 'critical',
      condition: "CPU % > 90.0 for at least 5 minutes on 'web-1'",
    });
    expect(view.where).toContainEqual({ label: 'Target', value: 'web-1' });
    expect(view.links.map(l => l.label)).toEqual(
      expect.arrayContaining(['Open in New Relic', 'Runbook'])
    );
    expect(view.images[0]).toContain('gorgon.nr-assets.net');
  });

  it('reads a Dynatrace problem', () => {
    const view = readPayload(dynatraceProblem);
    expect(view).toMatchObject({
      title: 'Failure rate increase',
      status: 'firing',
      severity: 'error',
      condition: 'Service impact',
    });
    expect(view.where).toContainEqual({ label: 'Entities', value: 'checkout-service' });
    expect(view.tags).toEqual(expect.arrayContaining(['env:prod', 'team:payments']));
    expect(view.links[0]?.label).toBe('Open in Dynatrace');
    expect(readPayload({ ...dynatraceProblem, State: 'MERGED' }).status).toBe('resolved');
  });

  it('reads an AppDynamics health rule violation', () => {
    const view = readPayload(appDynamicsEvent);
    expect(view).toMatchObject({
      title: 'BT response time',
      status: 'firing',
      severity: 'critical',
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Application', value: 'checkout' },
        { label: 'Tier', value: 'api' },
        { label: 'Entity', value: 'BUSINESS_TRANSACTION: /checkout' },
      ])
    );
    expect(view.links[0]?.label).toBe('Open in AppDynamics');
    expect(readPayload({ ...appDynamicsEvent, eventType: 'POLICY_CLOSE_CRITICAL' }).status).toBe(
      'resolved'
    );
  });

  it('reads a Splunk saved-search alert', () => {
    const view = readPayload(splunkSearch);
    expect(view).toMatchObject({ title: 'Checkout 5xx spike', status: 'firing' });
    expect(view.where).toContainEqual({ label: 'App', value: 'search' });
    expect(view.links[0]?.label).toBe('Open results in Splunk');
  });

  it('reads a Splunk Observability detector', () => {
    const view = readPayload(signalFxDetector);
    expect(view).toMatchObject({
      title: 'Critical Alert: Host CPU (CPU above 90)',
      status: 'firing',
      severity: 'critical',
      condition: 'CPU above 90',
      measured: { value: '97.2', threshold: '90' },
      query: { language: 'SignalFlow' },
    });
    expect(view.where).toContainEqual({ label: 'Detector', value: 'Host CPU' });
    expect(view.links.map(l => l.label)).toEqual(
      expect.arrayContaining(['Open detector', 'Runbook'])
    );
    expect(view.images).toContain('https://static.signalfx.com/chart/abc.png');
    expect(readPayload({ ...signalFxDetector, status: 'ok' }).status).toBe('resolved');
  });

  it('reads a Kibana alerting webhook', () => {
    const view = readPayload(kibanaAlert);
    expect(view).toMatchObject({
      title: 'High CPU on hosts',
      status: 'firing',
      measured: { value: '92.3%', threshold: '90%' },
    });
    expect(view.message).toContain('92.3%');
    expect(view.tags).toEqual(expect.arrayContaining(['infra', 'prod']));
    expect(view.links.map(l => l.label)).toEqual(
      expect.arrayContaining(['Alert details', 'Open in Kibana', 'Rule'])
    );
    expect(
      readPayload({ ...kibanaAlert, alert: { ...kibanaAlert.alert, actionGroup: 'recovered' } })
        .status
    ).toBe('resolved');
  });

  it('reads a Honeycomb trigger', () => {
    const view = readPayload(honeycombTrigger);
    expect(view).toMatchObject({
      title: 'Checkout latency P99',
      status: 'firing',
      measured: { value: '2140', threshold: '> 1500' },
    });
    expect(view.where).toContainEqual({ label: 'service.name', value: 'checkout' });
    expect(view.links.map(l => l.label)).toEqual(['Query results', 'Trigger']);
    expect(JSON.stringify(view)).not.toContain('not-a-real-secret');
  });

  it('reads a Sumo Logic monitor alert', () => {
    const view = readPayload(sumoMonitor);
    expect(view).toMatchObject({
      title: 'Login failures spike',
      status: 'firing',
      severity: 'critical',
      condition: 'Greater than or equal to 100',
      measured: { value: '342', threshold: null },
      query: { language: 'Sumo Logic' },
    });
    expect(view.links.map(l => l.label)).toEqual(['Alert response', 'Open query']);
    const resolved = readPayload({ ...sumoMonitor, TriggerType: 'ResolvedCritical' });
    expect(resolved).toMatchObject({ status: 'resolved', severity: 'critical' });
  });

  it('reads a Coralogix alert', () => {
    const view = readPayload(coralogixAlert);
    expect(view).toMatchObject({
      title: 'Payment errors',
      status: 'firing',
      severity: 'error',
      condition: 'threshold 50 in 10 min',
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Application', value: 'payments' },
        { label: 'Subsystem', value: 'api' },
      ])
    );
    expect(view.tags).toContain('team:billing');
    expect(view.links.map(l => l.label)).toEqual(['Open in Coralogix', 'Logs']);
  });

  it('reads a ServiceNow Cloud Observability (Lightstep) alert', () => {
    const view = readPayload(lightstepAlert);
    expect(view).toMatchObject({
      title: 'Checkout p99 latency',
      status: 'firing',
      severity: 'critical',
      condition: 'p99 latency > 2000 ms',
      measured: { value: '2410' },
    });
    expect(view.where).toContainEqual({ label: 'Project', value: 'acme-prod' });
    expect(view.links[0]).toEqual({
      label: 'Open alert',
      url: 'https://app.lightstep.com/acme-prod/alerts/abc123',
    });
  });

  // Grafana sits ahead of the cloud batch and claims any alert with a `fingerprint`, so these two are
  // exercised by hint until that detector is narrowed.
  it('reads a SigNoz alert', () => {
    expect(reader('signoz').detect(alertmanagerCore)).toBe(false);
    const view = readPayload(signozAlert, { sourceHint: 'signoz' });
    expect(view).toMatchObject({
      source: { id: 'signoz' },
      title: 'Checkout error rate above 5%',
      status: 'firing',
      severity: 'critical',
    });
    expect(view.links.map(l => l.label).slice(0, 2)).toEqual([
      'Open rule in SigNoz',
      'Related logs',
    ]);
    expect(view.tags).toContain('service_name:checkout');
  });

  it('reads a Chronosphere alert', () => {
    expect(reader('chronosphere').detect(alertmanagerCore)).toBe(false);
    const view = readPayload(chronosphereAlert, { sourceHint: 'chronosphere' });
    expect(view).toMatchObject({
      source: { id: 'chronosphere' },
      title: 'Pod restarts',
      status: 'firing',
      severity: 'warn',
    });
    expect(view.where).toEqual(
      expect.arrayContaining([
        { label: 'Monitor', value: 'pod-restarts' },
        { label: 'Notifier', value: 'opsknight webhook' },
      ])
    );
  });
});

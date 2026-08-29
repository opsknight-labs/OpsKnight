/**
 * Zod Schemas for Integration Payloads
 *
 * Provides runtime validation for all webhook payloads.
 * Ensures data integrity before processing.
 */

import { z } from 'zod';

// ============================================
// Common Types
// ============================================

export const SeveritySchema = z.enum(['critical', 'error', 'warning', 'info']);

export const EventActionSchema = z.enum(['trigger', 'resolve', 'acknowledge']);

export const StandardEventSchema = z.object({
  event_action: EventActionSchema,
  dedup_key: z.string().min(1),
  payload: z.object({
    summary: z.string().min(1),
    source: z.string().min(1),
    severity: SeveritySchema,
    custom_details: z.unknown().optional(),
  }),
});

export type StandardEvent = z.infer<typeof StandardEventSchema>;

// ============================================
// AWS CloudWatch
// ============================================

export const CloudWatchAlarmSchema = z.object({
  AlarmName: z.string(),
  AlarmDescription: z.string().nullable().optional(),
  AWSAccountId: z.string().nullable().optional(),
  NewStateValue: z.enum(['OK', 'ALARM', 'INSUFFICIENT_DATA']),
  NewStateReason: z.string().nullable().optional(),
  StateChangeTime: z.string(),
  Region: z.string().optional(),
  Trigger: z
    .object({
      MetricName: z.string().optional(),
      Namespace: z.string().optional(),
      Statistic: z.string().optional(),
      Threshold: z.number().optional(),
    })
    .nullable()
    .optional(),
});

// SNS wrapper for CloudWatch
export const SNSNotificationSchema = z.object({
  Type: z.literal('Notification'),
  Message: z.string(),
  MessageId: z.string().optional(),
  TopicArn: z.string().optional(),
  Timestamp: z.string().optional(),
});

export type CloudWatchAlarmMessage = z.infer<typeof CloudWatchAlarmSchema>;

// ============================================
// Azure Monitor
// ============================================

export const AzureAlertSchema = z.object({
  schemaId: z.string().optional(),
  data: z
    .object({
      essentials: z
        .object({
          alertId: z.string().optional(),
          alertRule: z.string().optional(),
          severity: z.string().optional(),
          signalType: z.string().optional(),
          monitorCondition: z.string().optional(),
          monitorService: z.string().optional(),
          firedDateTime: z.string().optional(),
          description: z.string().optional(),
        })
        .optional(),
      alertContext: z.unknown().optional(),
      context: z
        .object({
          id: z.string().optional(),
          name: z.string().optional(),
          description: z.string().optional(),
          conditionType: z.string().optional(),
          condition: z
            .object({
              windowSize: z.string().optional(),
              allOf: z
                .array(
                  z.object({
                    metricName: z.string().optional(),
                    threshold: z.number().optional(),
                  })
                )
                .optional(),
            })
            .optional(),
        })
        .optional(),
      properties: z.unknown().optional(),
    })
    .optional(),
});

export type AzureAlertData = z.infer<typeof AzureAlertSchema>;

// ============================================
// Datadog
// ============================================

export const DatadogSingleEventSchema = z.object({
  event_type: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  alert_type: z.enum(['error', 'warning', 'info', 'success']).optional(),
  date_happened: z.number().optional(),
  tags: z.array(z.string()).optional(),
  host: z.string().optional(),
  aggregation_key: z.string().optional(),
  source_type_name: z.string().optional(),
  alert: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
      severity: z.string().optional(),
    })
    .optional(),
  monitor: z
    .object({
      id: z.number().optional(),
      name: z.string().optional(),
      status: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export const DatadogEventSchema = z.union([
  DatadogSingleEventSchema,
  z.array(DatadogSingleEventSchema),
]);

export type DatadogSingleEvent = z.infer<typeof DatadogSingleEventSchema>;
export type DatadogEvent = z.infer<typeof DatadogEventSchema>;

// ============================================
// GitHub / GitLab
// ============================================

export const GitHubEventSchema = z.object({
  action: z.string().optional(),
  repository: z
    .object({
      name: z.string(),
      full_name: z.string(),
      html_url: z.string(),
    })
    .optional(),
  workflow_run: z
    .object({
      id: z.number(),
      name: z.string(),
      head_branch: z.string().optional(),
      status: z.enum(['queued', 'in_progress', 'completed', 'requested']),
      conclusion: z
        .enum([
          'success',
          'failure',
          'neutral',
          'cancelled',
          'timed_out',
          'action_required',
          'stale',
          'skipped',
        ])
        .nullable()
        .optional(),
      html_url: z.string(),
    })
    .optional(),
  check_run: z
    .object({
      id: z.number(),
      name: z.string(),
      status: z.enum(['queued', 'in_progress', 'completed']),
      conclusion: z
        .enum([
          'success',
          'failure',
          'neutral',
          'cancelled',
          'timed_out',
          'action_required',
          'stale',
          'skipped',
        ])
        .nullable()
        .optional(),
      html_url: z.string(),
    })
    .optional(),
  workflow_job: z
    .object({
      id: z.number(),
      run_id: z.number().optional(),
      name: z.string(),
      head_branch: z.string().optional(),
      status: z.enum(['queued', 'in_progress', 'completed', 'waiting']),
      conclusion: z
        .enum([
          'success',
          'failure',
          'neutral',
          'cancelled',
          'timed_out',
          'action_required',
          'stale',
          'skipped',
        ])
        .nullable()
        .optional(),
      html_url: z.string().optional(),
    })
    .optional(),
  deployment: z
    .object({
      id: z.number(),
      environment: z.string(),
      state: z.enum(['pending', 'success', 'failure', 'error']),
    })
    .optional(),
  // GitLab format
  object_kind: z.string().optional(),
  project: z
    .object({
      name: z.string(),
      path_with_namespace: z.string(),
      web_url: z.string(),
    })
    .optional(),
  build_status: z.string().optional(),
  status: z.string().optional(),
  ref: z.string().optional(),
  commit: z
    .object({
      message: z.string(),
    })
    .optional(),
});

export type GitHubEvent = z.infer<typeof GitHubEventSchema>;

// ============================================
// Grafana
// ============================================

export const GrafanaAlertSchema = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  state: z.enum(['alerting', 'ok', 'no_data', 'pending', 'paused']).optional(),
  ruleId: z.number().optional(),
  ruleName: z.string().optional(),
  ruleUrl: z.string().optional(),
  evalMatches: z
    .array(
      z.object({
        metric: z.string(),
        value: z.number(),
        tags: z.record(z.string()).optional(),
      })
    )
    .optional(),
  tags: z.record(z.string()).optional(),
  dashboardId: z.number().optional(),
  panelId: z.number().optional(),
  orgId: z.number().optional(),
  // Alertmanager format
  alerts: z
    .array(
      z.object({
        status: z.string(),
        labels: z.record(z.string()),
        annotations: z.record(z.string()).optional(),
        startsAt: z.string(),
        endsAt: z.string().optional(),
      })
    )
    .optional(),
  status: z.string().optional(),
  groupLabels: z.record(z.string()).optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
});

export type GrafanaAlert = z.infer<typeof GrafanaAlertSchema>;

// ============================================
// Prometheus Alertmanager
// ============================================

export const PrometheusAlertSchema = z.object({
  version: z.string().optional(),
  groupKey: z.string().optional(),
  status: z.enum(['firing', 'resolved']),
  receiver: z.string().optional(),
  groupLabels: z.record(z.string()).optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
  externalURL: z.string().optional(),
  alerts: z
    .array(
      z.object({
        status: z.enum(['firing', 'resolved']),
        labels: z.record(z.string()),
        annotations: z.record(z.string()).optional(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        generatorURL: z.string().optional(),
        fingerprint: z.string().optional(),
      })
    )
    .min(1),
});

export type PrometheusAlert = z.infer<typeof PrometheusAlertSchema>;

// ============================================
// New Relic
// ============================================

export const NewRelicEventSchema = z.object({
  account_id: z.number().optional(),
  account_name: z.string().optional(),
  event_type: z.string().optional(),
  incident: z
    .object({
      id: z.string(),
      title: z.string(),
      state: z.string().optional(),
      severity: z.string().optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
      condition_name: z.string().optional(),
      condition_id: z.number().optional(),
      policy_name: z.string().optional(),
      policy_id: z.number().optional(),
    })
    .optional(),
  alert: z
    .object({
      id: z.string(),
      alert_policy_name: z.string(),
      alert_condition_name: z.string(),
      severity: z.string(),
      timestamp: z.number(),
      state: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  alertType: z.string().optional(),
  alertSeverity: z.string().optional(),
  alertTitle: z.string().optional(),
  alertMessage: z.string().optional(),
  alertTimestamp: z.number().optional(),
});

export type NewRelicEvent = z.infer<typeof NewRelicEventSchema>;

// ============================================
// Sentry
// ============================================

export const SentryEventSchema = z.object({
  action: z.string().optional(),
  issue: z
    .object({
      id: z.string().optional(),
      shortId: z.string().nullable().optional(),
      title: z.string().optional(),
      culprit: z.string().nullable().optional(),
      level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']).optional(),
      status: z.enum(['unresolved', 'resolved', 'ignored']).optional(),
      assignedTo: z
        .object({
          name: z.string().optional(),
          email: z.string().optional(),
        })
        .nullable()
        .optional(),
      metadata: z
        .object({
          type: z.string().optional(),
          value: z.string().optional(),
        })
        .nullable()
        .optional(),
      permalink: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  event: z
    .object({
      event_id: z.string().optional(),
      message: z.string().optional(),
      level: z.string().optional(),
      timestamp: z.union([z.number(), z.string()]).optional(),
      platform: z.string().optional(),
      tags: z.record(z.string()).optional(),
      contexts: z.record(z.unknown()).optional(),
    })
    .nullable()
    .optional(),
  project: z
    .object({
      name: z.string().optional(),
      slug: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export type SentryEvent = z.infer<typeof SentryEventSchema>;

// ============================================
// Google Cloud Monitoring (Pub/Sub)
// ============================================

export const GoogleCloudMonitoringSchema = z
  .object({
    incident: z
      .object({
        incident_id: z.string().optional(),
        state: z.string().optional(),
        summary: z.string().optional(),
        policy_name: z.string().optional(),
        severity: z.string().optional(),
        resource: z
          .object({
            type: z.string().optional(),
            display_name: z.string().optional(),
            labels: z.record(z.string()).optional(),
          })
          .optional(),
        condition: z
          .object({
            name: z.string().optional(),
          })
          .optional(),
        started_at: z.string().optional(),
        ended_at: z.string().optional(),
      })
      .optional(),
    summary: z.string().optional(),
    state: z.string().optional(),
    severity: z.string().optional(),
  })
  .passthrough();

export type GoogleCloudMonitoringEvent = z.infer<typeof GoogleCloudMonitoringSchema>;

// ============================================
// Splunk On-Call
// ============================================

export const SplunkOnCallSchema = z
  .object({
    message_type: z.string().optional(),
    entity_id: z.string().optional(),
    entity_display_name: z.string().optional(),
    state_message: z.string().optional(),
    incident_id: z.union([z.string(), z.number()]).optional(),
    state: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    severity: z.string().optional(),
    alert: z
      .object({
        id: z.string().optional(),
        message: z.string().optional(),
        severity: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export type SplunkOnCallEvent = z.infer<typeof SplunkOnCallSchema>;

// ============================================
// Splunk Observability
// ============================================

export const SplunkObservabilitySchema = z
  .object({
    incidentId: z.union([z.string(), z.number()]).optional(),
    detectorId: z.union([z.string(), z.number()]).optional(),
    detectorName: z.string().optional(),
    severity: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    eventType: z.string().optional(),
    status: z.string().optional(),
    link: z.string().optional(),
  })
  .passthrough();

export type SplunkObservabilityEvent = z.infer<typeof SplunkObservabilitySchema>;

// ============================================
// Dynatrace
// ============================================

export const DynatraceSchema = z
  .object({
    ProblemID: z.union([z.string(), z.number()]).optional(),
    ProblemTitle: z.string().optional(),
    ProblemDetailsText: z.string().optional(),
    State: z.string().optional(),
    SeverityLevel: z.string().optional(),
    ProblemImpact: z.string().optional(),
    ProblemURL: z.string().optional(),
  })
  .passthrough();

export type DynatraceEvent = z.infer<typeof DynatraceSchema>;

// ============================================
// AppDynamics
// ============================================

export const AppDynamicsSchema = z
  .object({
    eventType: z.string().optional(),
    eventMessage: z.string().optional(),
    summary: z.string().optional(),
    severity: z.string().optional(),
    eventSeverity: z.string().optional(),
    application: z.string().optional(),
    incidentId: z.union([z.string(), z.number()]).optional(),
    eventId: z.union([z.string(), z.number()]).optional(),
    eventTime: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type AppDynamicsEvent = z.infer<typeof AppDynamicsSchema>;

// ============================================
// Elastic (Kibana Alerting)
// ============================================

export const ElasticSchema = z
  .object({
    rule: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
    alert: z
      .object({
        id: z.string().optional(),
        status: z.string().optional(),
        severity: z.string().optional(),
        reason: z.string().optional(),
      })
      .optional(),
    context: z
      .object({
        message: z.string().optional(),
        severity: z.string().optional(),
      })
      .optional(),
    event: z
      .object({
        action: z.string().optional(),
      })
      .optional(),
    message: z.string().optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
  })
  .passthrough();

export type ElasticEvent = z.infer<typeof ElasticSchema>;

// ============================================
// Honeycomb
// ============================================

export const HoneycombSchema = z
  .object({
    alert_id: z.string().optional(),
    alert_name: z.string().optional(),
    alert_severity: z.string().optional(),
    event_type: z.string().optional(),
    status: z.string().optional(),
    trigger_reason: z.string().optional(),
    result_url: z.string().optional(),
    dataset: z.string().optional(),
  })
  .passthrough();

export type HoneycombEvent = z.infer<typeof HoneycombSchema>;

// ============================================
// Bitbucket
// ============================================

export const BitbucketSchema = z
  .object({
    event: z.string().optional(),
    repository: z
      .object({
        name: z.string().optional(),
        full_name: z.string().optional(),
        uuid: z.string().optional(),
        links: z
          .object({
            html: z
              .object({
                href: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    pipeline: z
      .object({
        uuid: z.string().optional(),
        build_number: z.number().optional(),
        state: z
          .object({
            name: z.string().optional(),
            result: z
              .object({
                name: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
    status: z.string().optional(),
  })
  .passthrough();

export type BitbucketEvent = z.infer<typeof BitbucketSchema>;

// ============================================
// UptimeRobot
// ============================================

export const UptimeRobotSchema = z
  .object({
    alertType: z.union([z.string(), z.number()]).optional(),
    alertTypeFriendlyName: z.string().optional(),
    monitorID: z.union([z.string(), z.number()]).optional(),
    monitorFriendlyName: z.string().optional(),
    alertDetails: z.string().optional(),
    alertDateTime: z.string().optional(),
  })
  .passthrough();

export type UptimeRobotEvent = z.infer<typeof UptimeRobotSchema>;

// ============================================
// Pingdom
// ============================================

export const PingdomSchema = z
  .object({
    check_id: z.union([z.string(), z.number()]).optional(),
    check_name: z.string().optional(),
    state: z.string().optional(),
    message: z.string().optional(),
    description: z.string().optional(),
    last_error: z.string().optional(),
    time: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type PingdomEvent = z.infer<typeof PingdomSchema>;

// ============================================
// Better Uptime
// ============================================

export const BetterUptimeSchema = z
  .object({
    incident: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        name: z.string().optional(),
        status: z.string().optional(),
        severity: z.string().optional(),
        cause: z.string().optional(),
        started_at: z.string().optional(),
        resolved_at: z.string().optional(),
        url: z.string().optional(),
      })
      .optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    severity: z.string().optional(),
  })
  .passthrough();

export type BetterUptimeEvent = z.infer<typeof BetterUptimeSchema>;

// ============================================
// Uptime Kuma
// ============================================

export const UptimeKumaSchema = z
  .object({
    heartbeat: z
      .object({
        status: z.union([z.number(), z.string(), z.null()]).optional(),
        msg: z.union([z.string(), z.null()]).optional(),
        monitorID: z.union([z.number(), z.string(), z.null()]).optional(),
      })
      .nullable()
      .optional(),
    monitor: z
      .object({
        id: z.union([z.number(), z.string(), z.null()]).optional(),
        name: z.union([z.string(), z.null()]).optional(),
        url: z.union([z.string(), z.null()]).optional(),
      })
      .nullable()
      .optional(),
    status: z.union([z.string(), z.null()]).optional(),
    msg: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export type UptimeKumaEvent = z.infer<typeof UptimeKumaSchema>;

// ============================================
// Generic Webhook
// ============================================

export const GenericWebhookSchema = z
  .object({
    // Standard fields (optional for flexibility)
    summary: z.string().optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    name: z.string().optional(),

    severity: z.string().optional(),
    level: z.string().optional(),
    priority: z.string().optional(),

    status: z.string().optional(),
    action: z.string().optional(),
    state: z.string().optional(),

    id: z.union([z.string(), z.number()]).optional(),
    alert_id: z.string().optional(),
    dedup_key: z.string().optional(),

    source: z.string().optional(),
    origin: z.string().optional(),
    system: z.string().optional(),
  })
  .passthrough(); // Allow additional unknown fields

export type GenericWebhookPayload = z.infer<typeof GenericWebhookSchema>;

// ============================================
// Nagios (Core & XI)
// ============================================

export const NagiosPayloadSchema = z
  .object({
    notificationtype: z.string().optional(),
    NOTIFICATIONTYPE: z.string().optional(),
    hostname: z.string().optional(),
    HOSTNAME: z.string().optional(),
    hostalias: z.string().optional(),
    HOSTALIAS: z.string().optional(),
    hostaddress: z.string().optional(),
    HOSTADDRESS: z.string().optional(),
    hoststate: z.string().optional(),
    HOSTSTATE: z.string().optional(),
    hostoutput: z.string().optional(),
    HOSTOUTPUT: z.string().optional(),
    servicedesc: z.string().optional(),
    SERVICEDESC: z.string().optional(),
    service: z.string().optional(),
    SERVICE: z.string().optional(),
    servicestate: z.string().optional(),
    SERVICESTATE: z.string().optional(),
    serviceoutput: z.string().optional(),
    SERVICEOUTPUT: z.string().optional(),
    longserviceoutput: z.string().optional(),
    LONGSERVICEOUTPUT: z.string().optional(),
    longhostoutput: z.string().optional(),
    LONGHOSTOUTPUT: z.string().optional(),
    checkcommand: z.string().optional(),
    CHECKCOMMAND: z.string().optional(),
    notificationnumber: z.union([z.string(), z.number()]).optional(),
    NOTIFICATIONNUMBER: z.union([z.string(), z.number()]).optional(),
    author: z.string().optional(),
    AUTHOR: z.string().optional(),
    comment: z.string().optional(),
    COMMENT: z.string().optional(),
    serviceackauthor: z.string().optional(),
    SERVICEACKAUTHOR: z.string().optional(),
    serviceackcomment: z.string().optional(),
    SERVICEACKCOMMENT: z.string().optional(),
    hostackauthor: z.string().optional(),
    HOSTACKAUTHOR: z.string().optional(),
    hostackcomment: z.string().optional(),
    HOSTACKCOMMENT: z.string().optional(),
  })
  .passthrough();

export type NagiosPayload = z.infer<typeof NagiosPayloadSchema>;

// ============================================
// Icinga (Icinga 2)
// ============================================

export const IcingaPayloadSchema = z
  .object({
    notification_type: z.string().optional(),
    notificationType: z.string().optional(),
    type: z.string().optional(),
    host_name: z.string().optional(),
    hostName: z.string().optional(),
    host: z.string().optional(),
    host_display_name: z.string().optional(),
    host_state: z.string().optional(),
    hostState: z.string().optional(),
    host_output: z.string().optional(),
    hostOutput: z.string().optional(),
    service_name: z.string().optional(),
    serviceName: z.string().optional(),
    service: z.string().optional(),
    service_display_name: z.string().optional(),
    service_state: z.string().optional(),
    serviceState: z.string().optional(),
    service_output: z.string().optional(),
    serviceOutput: z.string().optional(),
    output: z.string().optional(),
    check_command: z.string().optional(),
    checkCommand: z.string().optional(),
    author: z.string().optional(),
    comment: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type IcingaPayload = z.infer<typeof IcingaPayloadSchema>;

// ============================================
// Zabbix
// ============================================

export const ZabbixPayloadSchema = z
  .object({
    event_id: z.union([z.string(), z.number()]).optional(),
    eventId: z.union([z.string(), z.number()]).optional(),
    event_name: z.string().optional(),
    eventName: z.string().optional(),
    event_status: z.string().optional(),
    eventStatus: z.string().optional(),
    event_value: z.union([z.string(), z.number()]).optional(),
    eventValue: z.union([z.string(), z.number()]).optional(),
    event_severity: z.string().optional(),
    eventSeverity: z.string().optional(),
    event_source: z.union([z.string(), z.number()]).optional(),
    event_object: z.union([z.string(), z.number()]).optional(),
    event_date: z.string().optional(),
    event_time: z.string().optional(),
    event_tags: z.union([z.string(), z.array(z.any()), z.record(z.any())]).optional(),
    event_url: z.string().optional(),
    eventUrl: z.string().optional(),
    event_opdata: z.string().optional(),
    eventOpdata: z.string().optional(),
    host_name: z.string().optional(),
    hostName: z.string().optional(),
    host_ip: z.string().optional(),
    hostIp: z.string().optional(),
    item_name: z.string().optional(),
    itemName: z.string().optional(),
    item_key: z.string().optional(),
    itemKey: z.string().optional(),
    item_value: z.union([z.string(), z.number()]).optional(),
    itemValue: z.union([z.string(), z.number()]).optional(),
    trigger_id: z.union([z.string(), z.number()]).optional(),
    triggerId: z.union([z.string(), z.number()]).optional(),
    trigger_name: z.string().optional(),
    triggerName: z.string().optional(),
    trigger_description: z.string().optional(),
    triggerDescription: z.string().optional(),
    trigger_status: z.string().optional(),
    trigger_value: z.union([z.string(), z.number()]).optional(),
    action: z.string().optional(),
    message: z.string().optional(),
    subject: z.string().optional(),
    severity: z.string().optional(),
    status: z.string().optional(),
    ack_user: z.string().optional(),
    ack_message: z.string().optional(),
  })
  .passthrough();

export type ZabbixPayload = z.infer<typeof ZabbixPayloadSchema>;

// ============================================
// PagerDuty Events API v2
// ============================================

export const PagerDutyEventSchema = z
  .object({
    routing_key: z.string().optional(),
    routingKey: z.string().optional(),
    event_action: z.enum(['trigger', 'acknowledge', 'resolve']).optional(),
    eventAction: z.enum(['trigger', 'acknowledge', 'resolve']).optional(),
    action: z.string().optional(),
    dedup_key: z.string().optional(),
    dedupKey: z.string().optional(),
    client: z.string().optional(),
    client_url: z.string().optional(),
    payload: z
      .object({
        summary: z.string().optional(),
        source: z.string().optional(),
        severity: z.enum(['critical', 'error', 'warning', 'info']).optional(),
        timestamp: z.string().optional(),
        component: z.string().optional(),
        group: z.string().optional(),
        class: z.string().optional(),
        custom_details: z.record(z.unknown()).optional(),
      })
      .optional(),
    images: z
      .array(
        z.object({
          src: z.string(),
          href: z.string().optional(),
          alt: z.string().optional(),
        })
      )
      .optional(),
    links: z
      .array(
        z.object({
          href: z.string(),
          text: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export type PagerDutyEvent = z.infer<typeof PagerDutyEventSchema>;

// ============================================
// GitLab Webhooks
// ============================================

export const GitLabPayloadSchema = z
  .object({
    object_kind: z.string().optional(),
    event_type: z.string().optional(),
    user: z
      .object({
        name: z.string().optional(),
        username: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    project: z
      .object({
        id: z.number().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        web_url: z.string().optional(),
        path_with_namespace: z.string().optional(),
      })
      .optional(),
    object_attributes: z
      .object({
        id: z.number().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        state: z.string().optional(),
        status: z.string().optional(),
        action: z.string().optional(),
        url: z.string().optional(),
        severity: z.string().optional(),
        iid: z.number().optional(),
        source_branch: z.string().optional(),
        target_branch: z.string().optional(),
      })
      .passthrough()
      .optional(),
    build_status: z.string().optional(),
    build_id: z.number().optional(),
    build_name: z.string().optional(),
    build_stage: z.string().optional(),
    ref: z.string().optional(),
    tag: z.boolean().optional(),
    sha: z.string().optional(),
    before_sha: z.string().optional(),
    status: z.string().optional(),
    deployment_status: z.string().optional(),
    environment: z.string().optional(),
    stages: z.array(z.string()).optional(),
    commit: z
      .object({
        id: z.string().optional(),
        message: z.string().optional(),
        title: z.string().optional(),
        timestamp: z.string().optional(),
        url: z.string().optional(),
        author: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type GitLabPayload = z.infer<typeof GitLabPayloadSchema>;

// ============================================
// Vercel Webhooks
// ============================================

export const VercelPayloadSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    payload: z
      .object({
        deployment: z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
            url: z.string().optional(),
            meta: z.record(z.unknown()).optional(),
          })
          .passthrough()
          .optional(),
        project: z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
          })
          .passthrough()
          .optional(),
        target: z.string().optional(),
        plan: z.string().optional(),
        user: z.object({ id: z.string().optional(), username: z.string().optional() }).optional(),
        team: z.object({ id: z.string().optional(), slug: z.string().optional() }).optional(),
        error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
        name: z.string().optional(),
        domain: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type VercelPayload = z.infer<typeof VercelPayloadSchema>;

// ============================================
// Schema Validation Helper
// ============================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: Array<{ path: string; message: string }> };

/**
 * Validate a payload against a schema and return structured result
 */
export function validatePayload<T>(schema: z.ZodSchema<T>, payload: unknown): ValidationResult<T> {
  const result = schema.safeParse(payload);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(err => ({
    path: err.path.join('.'),
    message: err.message,
  }));

  return { success: false, errors };
}

// ============================================
// Export schemas by integration type
// ============================================

export const IntegrationSchemas = {
  CLOUDWATCH: CloudWatchAlarmSchema,
  AZURE: AzureAlertSchema,
  DATADOG: DatadogEventSchema,
  GITHUB: GitHubEventSchema,
  GRAFANA: GrafanaAlertSchema,
  PROMETHEUS: PrometheusAlertSchema,
  NEWRELIC: NewRelicEventSchema,
  SENTRY: SentryEventSchema,
  GOOGLE_CLOUD_MONITORING: GoogleCloudMonitoringSchema,
  SPLUNK_ONCALL: SplunkOnCallSchema,
  SPLUNK_OBSERVABILITY: SplunkObservabilitySchema,
  DYNATRACE: DynatraceSchema,
  APPDYNAMICS: AppDynamicsSchema,
  ELASTIC: ElasticSchema,
  HONEYCOMB: HoneycombSchema,
  BITBUCKET: BitbucketSchema,
  UPTIMEROBOT: UptimeRobotSchema,
  PINGDOM: PingdomSchema,
  BETTER_UPTIME: BetterUptimeSchema,
  UPTIME_KUMA: UptimeKumaSchema,
  NAGIOS: NagiosPayloadSchema,
  ICINGA: IcingaPayloadSchema,
  ZABBIX: ZabbixPayloadSchema,
  PAGERDUTY: PagerDutyEventSchema,
  GITLAB: GitLabPayloadSchema,
  VERCEL: VercelPayloadSchema,
  WEBHOOK: GenericWebhookSchema,
} as const;

export type IntegrationSchemaType = keyof typeof IntegrationSchemas;

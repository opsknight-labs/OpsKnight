import { describe, expect, it } from 'vitest';
import { sanitizeProviderData } from '@/lib/integrations/payload-security';
import { readPayload } from '@/lib/payload-reader';
import { parseAny } from '@/lib/payload-reader/formats';
import { TOOL_READERS } from '@/lib/payload-reader/sources/tools';

/**
 * One realistic payload per tool (fake values; shapes from the repo's integration adapters or the vendor's
 * documented example). Every fixture must be claimed by its own reader and by no other.
 */

type Case = {
  name: string;
  raw: unknown;
  id: string;
  title: string;
  status: string | null;
  severity?: string | null;
  where?: Record<string, string>;
  links?: string[];
};

const CASES: Case[] = [
  {
    name: 'Sentry issue alert (integration platform)',
    id: 'sentry',
    raw: {
      action: 'triggered',
      installation: { uuid: '7a485448-a9e2-4c85-8a3c-4f44175783c9' },
      data: {
        event: {
          event_id: 'ec3fb9b4bf0f4b34a0b4c6c1f4c3d3b1',
          issue_id: '1170820242',
          issue_url: 'https://sentry.io/api/0/issues/1170820242/',
          web_url: 'https://sentry.io/organizations/acme/issues/1170820242/events/ec3fb9b4/',
          title: "TypeError: Cannot read properties of undefined (reading 'id')",
          level: 'error',
          culprit: 'app/checkout/submit.ts in handleSubmit',
          environment: 'production',
          release: 'web@4.12.0',
          datetime: '2026-11-22T15:27:00.000000Z',
          tags: [
            ['environment', 'production'],
            ['browser', 'Chrome 131'],
          ],
          metadata: { value: "Cannot read properties of undefined (reading 'id')" },
        },
        triggered_rule: 'New issue in checkout',
      },
      actor: { type: 'application', id: 'sentry', name: 'Sentry' },
    },
    title: "TypeError: Cannot read properties of undefined (reading 'id')",
    status: 'firing',
    severity: 'error',
    where: { Env: 'production', Release: 'web@4.12.0' },
    links: ['https://sentry.io/organizations/acme/issues/1170820242/events/ec3fb9b4/'],
  },
  {
    name: 'Sentry metric alert',
    id: 'sentry',
    raw: {
      action: 'critical',
      installation: { uuid: '7a485448-a9e2-4c85-8a3c-4f44175783c9' },
      data: {
        metric_alert: {
          id: '4417',
          title: 'p95 latency',
          date_started: '2026-11-22T15:20:00Z',
          date_detected: '2026-11-22T15:27:00Z',
          alert_rule: {
            name: 'p95 latency',
            aggregate: 'p95(transaction.duration)',
            query: 'transaction:/api/checkout',
            environment: 'production',
            projects: ['checkout-api'],
          },
        },
        description_title: 'Critical: p95 latency',
        description_text: '2350ms p95(transaction.duration) in the last 10 minutes',
        web_url: 'https://sentry.io/organizations/acme/alerts/rules/details/4417/',
      },
    },
    title: 'Critical: p95 latency',
    status: 'firing',
    severity: 'critical',
    where: { Env: 'production', Project: 'checkout-api' },
    links: ['https://sentry.io/organizations/acme/alerts/rules/details/4417/'],
  },
  {
    name: 'Sentry issue webhook',
    id: 'sentry',
    raw: {
      action: 'resolved',
      installation: { uuid: '7a485448-a9e2-4c85-8a3c-4f44175783c9' },
      data: {
        issue: {
          id: '1170820242',
          shortId: 'CHECKOUT-3F',
          title: 'ConnectionError: database unavailable',
          culprit: 'db.pool in acquire',
          level: 'fatal',
          status: 'resolved',
          permalink: 'https://acme.sentry.io/issues/1170820242/',
          project: { slug: 'checkout-api', name: 'checkout-api' },
          firstSeen: '2026-11-22T15:00:00Z',
          lastSeen: '2026-11-22T15:26:00Z',
          count: '42',
          userCount: 7,
        },
      },
    },
    title: 'ConnectionError: database unavailable',
    status: 'resolved',
    severity: 'fatal',
    where: { Project: 'checkout-api', Culprit: 'db.pool in acquire' },
    links: ['https://acme.sentry.io/issues/1170820242/'],
  },
  {
    name: 'Bugsnag',
    id: 'bugsnag',
    raw: {
      account: { id: '5f1a', name: 'Acme', url: 'https://app.bugsnag.com/acme' },
      project: {
        id: '6b2c',
        name: 'checkout-web',
        url: 'https://app.bugsnag.com/acme/checkout-web',
      },
      trigger: { type: 'firstException', message: 'New error in Production' },
      error: {
        id: '6b2c9d',
        errorId: '6b2c9d00',
        exceptionClass: 'RangeError',
        message: 'Maximum call stack size exceeded',
        context: '/checkout',
        severity: 'error',
        status: 'open',
        unhandled: true,
        firstReceived: '2026-11-22T15:25:00.000Z',
        receivedAt: '2026-11-22T15:27:00.000Z',
        url: 'https://app.bugsnag.com/acme/checkout-web/errors/6b2c9d',
        app: { releaseStage: 'production', version: '4.12.0' },
      },
    },
    title: 'RangeError: Maximum call stack size exceeded',
    status: 'firing',
    severity: 'error',
    where: { Project: 'checkout-web', Env: 'production', Context: '/checkout' },
    links: ['https://app.bugsnag.com/acme/checkout-web/errors/6b2c9d'],
  },
  {
    name: 'Rollbar',
    id: 'rollbar',
    raw: {
      event_name: 'new_item',
      data: {
        item: {
          id: 272505123,
          counter: 1287,
          environment: 'production',
          framework: 'node',
          title: 'ReferenceError: orderTotal is not defined',
          level: 'error',
          status: 'active',
          total_occurrences: 3,
          first_occurrence_timestamp: 1795361100,
          last_occurrence_timestamp: 1795361220,
          last_occurrence: { server: { host: 'web-3' } },
        },
        url: 'https://rollbar.com/acme/checkout/items/1287/',
      },
    },
    title: 'ReferenceError: orderTotal is not defined',
    status: 'firing',
    severity: 'error',
    where: { Env: 'production', Host: 'web-3' },
    links: ['https://rollbar.com/acme/checkout/items/1287/'],
  },
  {
    name: 'Raygun',
    id: 'raygun',
    raw: {
      event: 'error_notification',
      eventType: 'NewErrorOccurred',
      error: {
        url: 'https://app.raygun.com/crashreporting/abc12/errors/9988',
        message: 'NullReferenceException: Object reference not set to an instance of an object',
        firstOccurredOn: '2026-11-22T15:25:00Z',
        lastOccurredOn: '2026-11-22T15:27:00Z',
        usersAffected: 12,
        totalOccurrences: 30,
      },
      application: { name: 'Checkout', url: 'https://app.raygun.com/dashboard/abc12' },
    },
    title: 'NullReferenceException: Object reference not set to an instance of an object',
    status: 'firing',
    where: { Application: 'Checkout' },
    links: ['https://app.raygun.com/crashreporting/abc12/errors/9988'],
  },
  {
    name: 'PagerDuty Webhooks v3',
    id: 'pagerduty',
    raw: {
      event: {
        id: '01DEN7SQAVHJRMVE4FGS4FUW84',
        event_type: 'incident.acknowledged',
        resource_type: 'incident',
        occurred_at: '2026-11-22T15:30:00.000Z',
        agent: { summary: 'Jane Doe', type: 'user_reference' },
        data: {
          id: 'PGR0VU2',
          type: 'incident',
          html_url: 'https://acme.pagerduty.com/incidents/PGR0VU2',
          number: 2,
          status: 'acknowledged',
          title: 'Checkout API error rate high',
          created_at: '2026-11-22T15:27:00Z',
          urgency: 'high',
          service: {
            summary: 'Checkout API',
            html_url: 'https://acme.pagerduty.com/services/PF9KMXH',
          },
          priority: { summary: 'P1' },
          escalation_policy: { summary: 'Payments on-call' },
        },
      },
    },
    title: 'Checkout API error rate high',
    status: 'acknowledged',
    severity: 'p1',
    where: { Service: 'Checkout API', 'Escalation policy': 'Payments on-call' },
    links: [
      'https://acme.pagerduty.com/incidents/PGR0VU2',
      'https://acme.pagerduty.com/services/PF9KMXH',
    ],
  },
  {
    name: 'PagerDuty Events API v2',
    id: 'pagerduty',
    raw: {
      routing_key: 'R0UT1NGK3Y00000000000000000000',
      event_action: 'trigger',
      dedup_key: 'checkout-disk',
      payload: {
        summary: 'Disk 95% full on db-1',
        source: 'db-1.prod.internal',
        severity: 'critical',
        timestamp: '2026-11-22T15:27:00.000+0000',
        component: 'postgres',
        group: 'prod-datapipe',
        class: 'disk',
      },
      links: [{ href: 'https://grafana.example.com/d/disk', text: 'Disk dashboard' }],
      images: [{ src: 'https://chart.example.com/disk.png', alt: 'disk' }],
      client: 'Sample Monitoring Service',
      client_url: 'https://monitoring.example.com',
    },
    title: 'Disk 95% full on db-1',
    status: 'firing',
    severity: 'critical',
    where: { Source: 'db-1.prod.internal', Component: 'postgres' },
    links: ['https://monitoring.example.com', 'https://grafana.example.com/d/disk'],
  },
  {
    name: 'Opsgenie',
    id: 'opsgenie',
    raw: {
      action: 'Close',
      alert: {
        alertId: 'b9a2d1c8-0e6b-4a3f-9f43-4d1e5d2a3b44-1795361220000',
        message: 'CPU above 90% on api-2',
        tags: ['prod', 'api'],
        tinyId: '412',
        entity: 'api-2',
        alias: 'cpu-api-2',
        createdAt: 1795361220000,
        updatedAt: 1795361400000,
        description: 'CPU has been above 90% for 10 minutes',
        priority: 'P2',
        source: 'Datadog',
      },
      source: { name: '', type: 'web' },
      integrationName: 'OpsKnight Webhook',
      integrationId: '2c1f0e5b',
      integrationType: 'Webhook',
    },
    title: 'CPU above 90% on api-2',
    status: 'resolved',
    severity: 'p2',
    where: { Entity: 'api-2', Source: 'Datadog' },
  },
  {
    name: 'Splunk On-Call',
    id: 'splunk-oncall',
    raw: {
      message_type: 'CRITICAL',
      entity_id: 'disk.space/db-1',
      entity_display_name: 'Disk space low on db-1',
      state_message: 'Free space below 5% on /var/lib/postgresql',
      state_start_time: 1795361220,
      monitoring_tool: 'Nagios',
      host_name: 'db-1',
      'vo_annotate.u.Runbook': 'https://wiki.example.com/runbooks/disk',
    },
    title: 'Disk space low on db-1',
    status: 'firing',
    severity: 'critical',
    where: { Entity: 'disk.space/db-1', Host: 'db-1' },
    links: ['https://wiki.example.com/runbooks/disk'],
  },
  {
    name: 'Zabbix webhook JSON',
    id: 'zabbix',
    raw: {
      event_id: '73421',
      event_name: 'High CPU utilization (over 90% for 5m)',
      event_severity: 'High',
      event_value: '1',
      event_date: '2026.11.22',
      event_time: '15:27:00',
      event_opdata: 'Current utilization: 96.1 %',
      event_tags: 'scope:performance,component:cpu',
      host_name: 'web-01',
      host_ip: '10.0.4.21',
      trigger_id: '23411',
      trigger_name: 'High CPU utilization (over 90% for 5m)',
      item_name: 'CPU utilization',
      item_value: '96.1 %',
      item_key: 'system.cpu.util',
      event_url: 'https://zabbix.example.com/tr_events.php?triggerid=23411&eventid=73421',
    },
    title: 'High CPU utilization (over 90% for 5m)',
    status: 'firing',
    severity: 'high',
    where: { Host: 'web-01', IP: '10.0.4.21', Item: 'system.cpu.util' },
    links: ['https://zabbix.example.com/tr_events.php?triggerid=23411&eventid=73421'],
  },
  {
    name: 'Zabbix classic "Problem:" text',
    id: 'zabbix',
    raw: [
      'Problem: Free disk space is less than 10% on volume /',
      'Problem started at 15:27:00 on 2026.11.22',
      'Problem name: Free disk space is less than 10% on volume /',
      'Host: db-2',
      'Severity: Average',
      'Operational data: Space utilization: 91.2 %',
      'Original problem ID: 73422',
    ].join('\n'),
    title: 'Free disk space is less than 10% on volume /',
    status: 'firing',
    severity: 'average',
    where: { Host: 'db-2' },
  },
  {
    name: 'Icinga 2 notification JSON',
    id: 'icinga',
    raw: {
      notification_type: 'PROBLEM',
      host_name: 'web-01',
      host_display_name: 'web-01.prod',
      service_name: 'http',
      service_display_name: 'HTTP',
      service_state: 'CRITICAL',
      service_output: 'HTTP CRITICAL - Socket timeout after 10 seconds',
      check_command: 'http',
      host_address: '10.0.4.21',
      timestamp: 1795361220,
    },
    title: 'HTTP on web-01 is CRITICAL',
    status: 'firing',
    severity: 'critical',
    where: { Host: 'web-01', Service: 'HTTP', Address: '10.0.4.21' },
  },
  {
    name: 'Nagios macros as KEY: value text',
    id: 'nagios',
    raw: [
      'NOTIFICATIONTYPE: RECOVERY',
      'HOSTNAME: db-1',
      'HOSTADDRESS: 10.0.4.30',
      'SERVICEDESC: PostgreSQL connections',
      'SERVICESTATE: OK',
      'SERVICEOUTPUT: OK - 42 connections',
      'SERVICEPERFDATA: connections=42;80;95;0;100',
      'LONGDATETIME: Sun Nov 22 15:27:00 UTC 2026',
    ].join('\n'),
    title: 'PostgreSQL connections on db-1 is OK',
    status: 'resolved',
    severity: 'ok',
    where: { Host: 'db-1', Service: 'PostgreSQL connections', Address: '10.0.4.30' },
  },
  {
    name: 'Nagios stock e-mail text',
    id: 'nagios',
    raw: [
      '***** Nagios *****',
      'Notification Type: PROBLEM',
      'Service: HTTP',
      'Host: web-02',
      'Address: 10.0.4.22',
      'State: WARNING',
      'Date/Time: Sun Nov 22 15:27:00 UTC 2026',
    ].join('\n'),
    title: 'HTTP on web-02 is WARNING',
    status: 'firing',
    severity: 'warning',
    where: { Host: 'web-02', Service: 'HTTP' },
  },
  {
    name: 'Netdata Cloud',
    id: 'netdata',
    raw: {
      message: 'db-1 needs attention, disk_space._ (/), disk space usage = 93.1%',
      alert: 'disk_space_usage',
      info: 'Disk / space utilization',
      chart: 'disk_space._',
      context: 'disk.space',
      space: 'Acme',
      Rooms: { 'All nodes': 'https://app.netdata.cloud/spaces/acme/rooms/all-nodes' },
      family: '/',
      class: 'Utilization',
      severity: 'critical',
      date: '2026-11-22T15:27:00Z',
      duration: '5 minutes',
      additional_active_critical_alerts: 0,
      additional_active_warning_alerts: 1,
      alert_url: 'https://app.netdata.cloud/alerts/redirect?alert=disk_space_usage',
    },
    title: 'db-1 needs attention, disk_space._ (/), disk space usage = 93.1%',
    status: 'firing',
    severity: 'critical',
    where: { Chart: 'disk_space._', Context: 'disk.space' },
    links: ['https://app.netdata.cloud/alerts/redirect?alert=disk_space_usage'],
  },
  {
    name: 'Pingdom',
    id: 'pingdom',
    raw: {
      check_id: 12345,
      check_name: 'Checkout page',
      check_type: 'HTTP',
      check_params: {
        basic_auth: false,
        hostname: 'shop.example.com',
        full_url: 'https://shop.example.com/checkout',
        port: 443,
      },
      tags: ['prod'],
      previous_state: 'UP',
      current_state: 'DOWN',
      importance_level: 'HIGH',
      state_changed_timestamp: 1795361220,
      state_changed_utc_time: '2026-11-22T15:27:00',
      long_description: 'HTTP Server Error 503 Service Unavailable',
      description: '503',
      first_probe: { ip: '10.9.8.7', location: 'Frankfurt, Germany' },
    },
    title: 'Checkout page is down',
    status: 'firing',
    severity: 'high',
    where: { Host: 'shop.example.com', Probe: 'Frankfurt, Germany' },
    links: ['https://shop.example.com/checkout'],
  },
  {
    name: 'UptimeRobot',
    id: 'uptimerobot',
    raw: {
      monitorID: '778899',
      monitorURL: 'https://api.example.com/health',
      monitorFriendlyName: 'API health',
      alertType: '2',
      alertTypeFriendlyName: 'Up',
      alertDetails: 'HTTP 200 - OK',
      alertDuration: '420',
      alertDateTime: '1795361640',
    },
    title: 'API health is up',
    status: 'resolved',
    links: ['https://api.example.com/health'],
  },
  {
    name: 'Uptime Kuma',
    id: 'uptime-kuma',
    raw: {
      heartbeat: {
        monitorID: 4,
        status: 0,
        time: '2026-11-22 15:27:00.123',
        msg: 'timeout of 48000ms exceeded',
        important: true,
        duration: 60,
        ping: null,
      },
      monitor: {
        id: 4,
        name: 'Billing API',
        url: 'https://billing.example.com/health',
        hostname: null,
        type: 'http',
        tags: [{ name: 'env', value: 'prod' }],
      },
      msg: '[Billing API] [🔴 Down] timeout of 48000ms exceeded',
    },
    title: 'Billing API is down',
    status: 'firing',
    where: { 'Monitor type': 'http' },
    links: ['https://billing.example.com/health'],
  },
  {
    name: 'Better Stack',
    id: 'better-stack',
    raw: {
      data: {
        id: '99887766',
        type: 'incident',
        attributes: {
          name: 'Checkout API',
          url: 'https://api.example.com/checkout/health',
          http_method: 'get',
          cause: 'Status 502',
          incident_group_id: null,
          started_at: '2026-11-22T15:27:00.000Z',
          acknowledged_at: null,
          resolved_at: null,
          status: 'Started',
          team_name: 'Payments',
          screenshot_url: 'https://uptime.betterstack.com/screenshots/99887766.png',
          regions: 'eu, us',
        },
      },
    },
    title: 'Checkout API',
    status: 'firing',
    where: { Team: 'Payments', Regions: 'eu, us' },
    links: ['https://api.example.com/checkout/health'],
  },
  {
    name: 'Checkly',
    id: 'checkly',
    raw: {
      event: 'Checkout flow has failed',
      alert_title: 'Checkout flow has failed',
      alert_type: 'ALERT_FAILURE',
      check_name: 'Checkout flow',
      check_id: '1f7b6c1e-3a1d-4d64-9d7e-1b0b4f4b8a11',
      check_type: 'BROWSER',
      check_result_id: '5e2a0f4e-6a2b-4c4e-8f1d-0a7c1b9f3e22',
      response_time: 12045,
      run_location: 'Frankfurt',
      group_name: 'Shop',
      result_link: 'https://app.checklyhq.com/checks/1f7b6c1e/results/5e2a0f4e',
      started_at: '2026-11-22T15:27:00.000Z',
      tags: ['prod', 'checkout'],
    },
    title: 'Checkout flow has failed',
    status: 'firing',
    severity: 'failure',
    where: { Check: 'Checkout flow', Location: 'Frankfurt', Group: 'Shop' },
    links: ['https://app.checklyhq.com/checks/1f7b6c1e/results/5e2a0f4e'],
  },
  {
    name: 'StatusCake (form body)',
    id: 'statuscake',
    raw: 'URL=https%3A%2F%2Fwww.example.com%2F&Token=5f4dcc3b5aa765d61d8327deb882cf99&Name=Marketing+site&StatusCode=500&Status=Down&IP=203.0.113.9&Tags=web%2Cprod&CheckRate=300',
    title: 'Marketing site is down',
    status: 'firing',
    where: { IP: '203.0.113.9' },
    links: ['https://www.example.com/'],
  },
  {
    name: 'Site24x7',
    id: 'site24x7',
    raw: {
      MONITORNAME: 'Storefront',
      MONITORURL: 'https://store.example.com',
      MONITORTYPE: 'URL',
      MONITOR_ID: '1234500000000123',
      STATUS: 'DOWN',
      INCIDENT_REASON: 'Connection timed out',
      INCIDENT_TIME_ISO: '2026-11-22T15:27:00+0000',
      MONITOR_DASHBOARD_LINK:
        'https://www.site24x7.com/app/client#/home/monitors/1234500000000123/Summary',
      RCA_LINK: 'https://www.site24x7.com/rca.do?id=abc',
      MONITOR_GROUPNAME: 'Shop',
      FAILED_LOCATIONS: 'London,Dallas',
      TAGS: 'env:prod',
    },
    title: 'Storefront is down',
    status: 'firing',
    severity: 'down',
    where: { Group: 'Shop', 'Failed locations': 'London,Dallas' },
    links: [
      'https://www.site24x7.com/app/client#/home/monitors/1234500000000123/Summary',
      'https://www.site24x7.com/rca.do?id=abc',
      'https://store.example.com',
    ],
  },
  {
    name: 'Healthchecks.io',
    id: 'healthchecks',
    raw: {
      name: 'Nightly backup',
      slug: 'nightly-backup',
      tags: 'prod db',
      desc: 'Runs ~/db-backup.sh',
      grace: 900,
      n_pings: 102,
      status: 'down',
      last_ping: '2026-11-21T02:00:05+00:00',
      next_ping: null,
      ping_url: 'https://hc-ping.com/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278',
      update_url: 'https://healthchecks.io/api/v3/checks/5bf66975-d4c7-4bf5-bcc8-b8d8a82ea278',
    },
    title: 'Nightly backup is down',
    status: 'firing',
  },
  {
    name: 'ManageEngine OpManager',
    id: 'manageengine',
    raw: {
      alarmid: 4092,
      entity: 'core-router-01_CPU_Utilization',
      displayName: 'core-router-01',
      stringseverity: 'Critical',
      severity: 1,
      message: 'CPU Utilization is 97%, threshold value is 90%',
      category: 'Router',
      eventType: 'CPU Utilization',
      ipAddress: '10.0.0.1',
      modTime: 1795361220000,
    },
    title: 'CPU Utilization is 97%, threshold value is 90%',
    status: 'firing',
    severity: 'critical',
    where: { Device: 'core-router-01', IP: '10.0.0.1', Category: 'Router' },
  },
  {
    name: 'GitHub workflow_run',
    id: 'github',
    raw: {
      action: 'completed',
      workflow_run: {
        id: 30433642,
        name: 'CI',
        head_branch: 'main',
        head_sha: 'acb5820ced9479c074f688cc328bf03f341a511d',
        display_title: 'Fix checkout rounding',
        event: 'push',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/acme/shop/actions/runs/30433642',
        run_started_at: '2026-11-22T15:20:00Z',
        updated_at: '2026-11-22T15:27:00Z',
        actor: { login: 'octocat' },
      },
      workflow: {
        name: 'CI',
        html_url: 'https://github.com/acme/shop/blob/main/.github/workflows/ci.yml',
      },
      repository: { full_name: 'acme/shop', html_url: 'https://github.com/acme/shop' },
      sender: { login: 'octocat' },
    },
    title: 'CI failed on main',
    status: 'firing',
    where: { Repository: 'acme/shop', Branch: 'main', Commit: 'acb5820' },
    links: ['https://github.com/acme/shop/actions/runs/30433642'],
  },
  {
    name: 'GitHub check_run',
    id: 'github',
    raw: {
      action: 'completed',
      check_run: {
        id: 128620228,
        name: 'lint',
        head_sha: 'acb5820ced9479c074f688cc328bf03f341a511d',
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/acme/shop/runs/128620228',
        started_at: '2026-11-22T15:20:00Z',
        completed_at: '2026-11-22T15:21:00Z',
        output: { title: 'No problems', summary: '0 errors' },
        check_suite: { head_branch: 'main' },
        app: { name: 'GitHub Actions' },
      },
      repository: { full_name: 'acme/shop', html_url: 'https://github.com/acme/shop' },
    },
    title: 'lint succeeded',
    status: 'resolved',
    where: { Repository: 'acme/shop', Branch: 'main' },
    links: ['https://github.com/acme/shop/runs/128620228'],
  },
  {
    name: 'GitHub deployment_status',
    id: 'github',
    raw: {
      action: 'created',
      deployment_status: {
        state: 'error',
        description: 'Deployment failed: health check timeout',
        environment: 'production',
        target_url: 'https://deploy.example.com/logs/991',
        created_at: '2026-11-22T15:27:00Z',
        creator: { login: 'deploy-bot' },
      },
      deployment: {
        ref: 'v4.12.0',
        sha: 'acb5820ced9479c074f688cc328bf03f341a511d',
        environment: 'production',
      },
      repository: { full_name: 'acme/shop', html_url: 'https://github.com/acme/shop' },
    },
    title: 'Deployment to production errored',
    status: 'firing',
    where: { Env: 'production', Ref: 'v4.12.0' },
    links: ['https://deploy.example.com/logs/991'],
  },
  {
    name: 'GitLab pipeline',
    id: 'gitlab',
    raw: {
      object_kind: 'pipeline',
      object_attributes: {
        id: 31,
        iid: 3,
        ref: 'main',
        sha: 'bcbb5ec396a2c0f828686f14fac9b80b780504f2',
        status: 'failed',
        source: 'push',
        created_at: '2026-11-22 15:20:00 UTC',
        finished_at: '2026-11-22 15:27:00 UTC',
        url: 'https://gitlab.example.com/acme/shop/-/pipelines/31',
      },
      user: { name: 'Jane Doe', username: 'jdoe' },
      project: {
        id: 1,
        name: 'shop',
        path_with_namespace: 'acme/shop',
        web_url: 'https://gitlab.example.com/acme/shop',
      },
      commit: {
        id: 'bcbb5ec3',
        title: 'Fix checkout rounding',
        url: 'https://gitlab.example.com/acme/shop/-/commit/bcbb5ec3',
      },
      builds: [
        { id: 380, stage: 'test', name: 'unit', status: 'failed' },
        { id: 381, stage: 'build', name: 'image', status: 'success' },
      ],
    },
    title: 'Pipeline #3 failed on main',
    status: 'firing',
    where: { Project: 'acme/shop', Branch: 'main', Author: 'Jane Doe' },
    links: ['https://gitlab.example.com/acme/shop/-/pipelines/31'],
  },
  {
    name: 'GitLab alert',
    id: 'gitlab',
    raw: {
      object_kind: 'alert',
      project: {
        path_with_namespace: 'acme/shop',
        web_url: 'https://gitlab.example.com/acme/shop',
      },
      object_attributes: {
        id: 77,
        title: 'Error rate above 5%',
        description: 'Prometheus alert from production',
        status: 'triggered',
        severity: 'high',
        environment: 'production',
        started_at: '2026-11-22T15:27:00Z',
        url: 'https://gitlab.example.com/acme/shop/-/alert_management/77/details',
      },
    },
    title: 'Error rate above 5%',
    status: 'firing',
    severity: 'high',
    where: { Project: 'acme/shop', Env: 'production' },
    links: ['https://gitlab.example.com/acme/shop/-/alert_management/77/details'],
  },
  {
    name: 'Bitbucket commit status',
    id: 'bitbucket',
    raw: {
      actor: { display_name: 'Jane Doe' },
      repository: {
        name: 'shop',
        full_name: 'acme/shop',
        uuid: '{1c2b3a4d-0000-4000-8000-123456789abc}',
        links: { html: { href: 'https://bitbucket.org/acme/shop' } },
      },
      commit_status: {
        key: 'pipeline-1234',
        name: 'Pipeline #1234 for main',
        state: 'FAILED',
        refname: 'main',
        url: 'https://bitbucket.org/acme/shop/pipelines/results/1234',
        commit: { hash: '9fceb02d0ae598e95dc970b74767f19372d61af8' },
        created_on: '2026-11-22T15:20:00.000000+00:00',
        updated_on: '2026-11-22T15:27:00.000000+00:00',
      },
    },
    title: 'Pipeline #1234 for main failed',
    status: 'firing',
    where: { Repository: 'acme/shop', Branch: 'main', Commit: '9fceb02' },
    links: ['https://bitbucket.org/acme/shop/pipelines/results/1234'],
  },
  {
    name: 'Vercel deployment.error',
    id: 'vercel',
    raw: {
      id: 'Ylaul3mZ8ByyY3nD2w5mT',
      type: 'deployment.error',
      createdAt: 1795361220000,
      region: 'iad1',
      payload: {
        team: { id: 'team_123' },
        user: { id: 'user_123' },
        deployment: {
          id: 'dpl_2euZBFqxYdDMDG1jTrHFnNZ2eUVa',
          name: 'storefront',
          url: 'storefront-k1x2y3.vercel.app',
          meta: {
            githubCommitRef: 'main',
            githubCommitSha: '9fceb02d0ae598e95dc970b74767f19372d61af8',
          },
        },
        links: {
          deployment: 'https://vercel.com/acme/storefront/2euZBFqxYdDMDG1jTrHFnNZ2eUVa',
          project: 'https://vercel.com/acme/storefront',
        },
        name: 'storefront',
        target: 'production',
      },
    },
    title: 'storefront production deployment errored',
    status: 'firing',
    where: { Project: 'storefront', Env: 'production', Branch: 'main' },
    links: [
      'https://vercel.com/acme/storefront/2euZBFqxYdDMDG1jTrHFnNZ2eUVa',
      'https://vercel.com/acme/storefront',
      'https://storefront-k1x2y3.vercel.app',
    ],
  },
  {
    name: 'Jenkins notification plugin',
    id: 'jenkins',
    raw: {
      name: 'shop-deploy',
      url: 'job/shop-deploy/',
      build: {
        full_url: 'https://jenkins.example.com/job/shop-deploy/42/',
        number: 42,
        queue_id: 1001,
        timestamp: 1795361100000,
        duration: 120000,
        phase: 'COMPLETED',
        status: 'FAILURE',
        url: 'job/shop-deploy/42/',
        scm: {
          url: 'https://github.com/acme/shop.git',
          branch: 'origin/main',
          commit: 'acb5820ced9479c074f688cc328bf03f341a511d',
        },
        log: 'ERROR: script returned exit code 1',
      },
    },
    title: 'shop-deploy #42 failed',
    status: 'firing',
    where: { Job: 'shop-deploy', Branch: 'origin/main', Commit: 'acb5820' },
    links: ['https://jenkins.example.com/job/shop-deploy/42/'],
  },
  {
    name: 'Kubernetes Event',
    id: 'kubernetes',
    raw: {
      apiVersion: 'v1',
      kind: 'Event',
      metadata: { name: 'checkout-api-7d9f.17a1', namespace: 'payments' },
      involvedObject: {
        kind: 'Pod',
        name: 'checkout-api-7d9f',
        namespace: 'payments',
        fieldPath: 'spec.containers{api}',
      },
      reason: 'BackOff',
      message: 'Back-off restarting failed container api in pod checkout-api-7d9f',
      source: { component: 'kubelet', host: 'node-a1' },
      firstTimestamp: '2026-11-22T15:20:00Z',
      lastTimestamp: '2026-11-22T15:27:00Z',
      count: 12,
      type: 'Warning',
    },
    title: 'BackOff: Pod/checkout-api-7d9f',
    status: 'firing',
    severity: 'warning',
    where: { Namespace: 'payments', Object: 'Pod/checkout-api-7d9f', Node: 'node-a1' },
  },
  {
    name: 'Argo CD notification',
    id: 'argocd',
    raw: {
      app: {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'Application',
        metadata: { name: 'checkout', namespace: 'argocd' },
        spec: {
          project: 'payments',
          source: { repoURL: 'https://github.com/acme/deploy.git', targetRevision: 'main' },
          destination: { server: 'https://kubernetes.default.svc', namespace: 'payments' },
        },
        status: {
          sync: { status: 'Synced', revision: '9fceb02d0ae598e95dc970b74767f19372d61af8' },
          health: {
            status: 'Degraded',
            message: 'Deployment "checkout" exceeded its progress deadline',
          },
          operationState: { phase: 'Succeeded', finishedAt: '2026-11-22T15:27:00Z' },
        },
      },
      context: { argocdUrl: 'https://argocd.example.com' },
    },
    title: 'checkout: Degraded / Synced',
    status: 'firing',
    severity: 'degraded',
    where: { App: 'checkout', Namespace: 'payments', Project: 'payments' },
    links: ['https://argocd.example.com/applications/checkout'],
  },
  {
    name: 'Atlassian Statuspage incident',
    id: 'statuspage',
    raw: {
      meta: {
        unsubscribe: 'https://status.example.com/?unsubscribe=j0vqr9kl3513',
        documentation: 'https://doers.statuspage.io/customer-notifications/webhooks/',
      },
      page: {
        id: 'j2mfxwj97wnj',
        status_indicator: 'major',
        status_description: 'Partial System Outage',
      },
      incident: {
        name: 'Elevated checkout errors',
        status: 'identified',
        impact: 'major',
        created_at: '2026-11-22T15:27:00.000Z',
        updated_at: '2026-11-22T15:40:00.000Z',
        shortlink: 'https://stspg.io/abc123',
        incident_updates: [
          { body: 'We have identified the issue and are rolling back.', status: 'identified' },
        ],
        components: [{ name: 'Checkout' }, { name: 'API' }],
      },
    },
    title: 'Elevated checkout errors',
    status: 'firing',
    severity: 'major',
    where: { Components: 'Checkout, API' },
    links: ['https://stspg.io/abc123'],
  },
  {
    name: 'Graylog event notification',
    id: 'graylog',
    raw: {
      event_definition_id: '5f2c1e9b8a1b2c3d4e5f6a7b',
      event_definition_type: 'aggregation-v1',
      event_definition_title: 'Too many failed logins',
      event_definition_description: 'More than 50 failed logins in 5 minutes',
      job_definition_id: '5f2c1e9b8a1b2c3d4e5f6a7c',
      job_trigger_id: '5f2c1e9b8a1b2c3d4e5f6a7d',
      event: {
        id: '01EXAMPLE0000000000000000',
        event_definition_type: 'aggregation-v1',
        event_definition_id: '5f2c1e9b8a1b2c3d4e5f6a7b',
        timestamp: '2026-11-22T15:27:00.000Z',
        timerange_start: '2026-11-22T15:22:00.000Z',
        timerange_end: '2026-11-22T15:27:00.000Z',
        streams: ['000000000000000000000001'],
        message: 'Too many failed logins: count()=73',
        source: 'graylog-1',
        key: 'auth-service',
        priority: 3,
        alert: true,
        fields: { service: 'auth' },
      },
      backlog: [{ message: 'login failed for user a' }, { message: 'login failed for user b' }],
    },
    title: 'Too many failed logins',
    status: 'firing',
    severity: 'high',
    where: { Source: 'graylog-1', Key: 'auth-service' },
  },
];

// Copied from tests/lib/payload-reader/payload-reader.test.ts.
const CORE: Array<{ id: string; raw: unknown }> = [
  {
    id: 'datadog',
    raw: {
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
    },
  },
  {
    id: 'alertmanager',
    raw: {
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
    },
  },
  {
    id: 'grafana',
    raw: {
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
    },
  },
];

describe('tool source readers', () => {
  it.each(CASES.map(c => [c.name, c] as const))('reads %s', (_name, c) => {
    const view = readPayload(c.raw);
    expect(view.source?.id).toBe(c.id);
    expect(view.title).toBe(c.title);
    expect(view.status).toBe(c.status);
    if (c.severity !== undefined) expect(view.severity).toBe(c.severity);
    for (const [label, value] of Object.entries(c.where ?? {})) {
      expect(view.where).toContainEqual({ label, value });
    }
    for (const url of c.links ?? []) {
      expect(view.links.map(l => l.url)).toContain(url);
    }
    for (const t of view.when) expect(Number.isNaN(Date.parse(t.at))).toBe(false);
  });

  it('claims every fixture with its own reader only', () => {
    // Every reader's detect runs on every fixture (as the format layer parses it): only the owner says yes.
    for (const c of CASES) {
      const parsed = sanitizeProviderData(parseAny(c.raw).data);
      const claimers = TOOL_READERS.filter(r => r.detect(parsed)).map(r => r.id);
      expect([c.name, claimers]).toEqual([c.name, [c.id]]);
    }
  });

  it('does not claim the core Datadog / Alertmanager / Grafana payloads', () => {
    for (const core of CORE) {
      expect(TOOL_READERS.filter(r => r.detect(core.raw)).map(r => r.id)).toEqual([]);
      expect(readPayload(core.raw).source?.id).toBe(core.id);
    }
  });

  it('reads the details each tool documents', () => {
    const zabbixText = readPayload(
      [
        'Resolved in 7m 0s: Free disk space is less than 10% on volume /',
        'Problem name: Free disk space is less than 10% on volume /',
        'Problem duration: 7m 0s',
        'Host: db-2',
        'Severity: Average',
        'Original problem ID: 73422',
      ].join('\n')
    );
    expect(zabbixText.status).toBe('resolved');

    const nagios = readPayload(CASES.find(c => c.name.startsWith('Nagios macros'))!.raw);
    expect(nagios.measured).toEqual({ value: 'connections = 42', threshold: 'warn 80, crit 95' });
    expect(nagios.when).toEqual([{ label: 'Notified', at: '2026-11-22T15:27:00.000Z' }]);

    const kuma = readPayload(CASES.find(c => c.id === 'uptime-kuma')!.raw);
    expect(kuma.when).toContainEqual({ label: 'Changed', at: '2026-11-22T15:27:00.123Z' });
    expect(kuma.tags).toContain('env:prod');

    const sentryIssue = readPayload(CASES[0].raw);
    expect(sentryIssue.condition).toBe('New issue in checkout');
    expect(sentryIssue.tags).toContain('browser:Chrome 131');

    const metric = readPayload(CASES[1].raw);
    expect(metric.query).toEqual({
      language: 'Sentry',
      text: 'p95(transaction.duration) where transaction:/api/checkout',
    });

    const pdEvents = readPayload(CASES.find(c => c.name === 'PagerDuty Events API v2')!.raw);
    expect(pdEvents.images).toContain('https://chart.example.com/disk.png');
    expect(pdEvents.links).toContainEqual({
      label: 'Disk dashboard',
      url: 'https://grafana.example.com/d/disk',
    });

    const gitlab = readPayload(CASES.find(c => c.name === 'GitLab pipeline')!.raw);
    expect(gitlab.condition).toBe('Failed jobs: unit');

    const k8s = readPayload(CASES.find(c => c.id === 'kubernetes')!.raw);
    expect(k8s.measured?.value).toBe('12 times');

    const pdV1 = readPayload({
      service_key: 'S3RV1C3K3Y',
      event_type: 'resolve',
      incident_key: 'disk-db-1',
      description: 'Disk space recovered on db-1',
    });
    expect(pdV1).toMatchObject({ source: { id: 'pagerduty' }, status: 'resolved' });

    const icingaApi = readPayload({
      type: 'StateChange',
      host: 'web-01',
      service: 'http',
      state: 2,
      state_type: 1,
      check_result: { output: 'HTTP CRITICAL - timeout', performance_data: ['time=10.0s;5;8;0'] },
      timestamp: 1795361220,
    });
    expect(icingaApi).toMatchObject({
      source: { id: 'icinga' },
      title: 'http on web-01 is CRITICAL',
      status: 'firing',
      measured: { value: 'time = 10.0s', threshold: 'warn 5, crit 8' },
    });
  });

  it('never throws on odd input', () => {
    for (const odd of [null, undefined, 0, '', 'text', [], [1, 2], { a: null }, { alerts: 'x' }]) {
      for (const reader of TOOL_READERS) expect(() => reader.detect(odd)).not.toThrow();
      expect(() => readPayload(odd)).not.toThrow();
    }
  });
});

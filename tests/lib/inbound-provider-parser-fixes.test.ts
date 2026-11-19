import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { transformPingdomToEvent } from '@/lib/integrations/pingdom';
import { transformBetterUptimeToEvent } from '@/lib/integrations/better-uptime';
import { transformUptimeKumaToEvent } from '@/lib/integrations/uptime-kuma';
import { transformUptimeRobotToEvent } from '@/lib/integrations/uptimerobot';
import { transformNagiosToEvent } from '@/lib/integrations/nagios';
import { transformIcingaToEvent } from '@/lib/integrations/icinga';
import { transformZabbixToEvent } from '@/lib/integrations/zabbix';
import {
  parseManageEngineAlarms,
  transformManageEngineToEvent,
} from '@/lib/integrations/manageengine';
import { normalizeEventAction } from '@/lib/integrations/normalization';
import { transformWebhookToEvent } from '@/lib/integrations/webhook';
import { transformBitbucketToEvent } from '@/lib/integrations/bitbucket';
import { transformGitLabToEvent } from '@/lib/integrations/gitlab';
import { transformVercelToEvent } from '@/lib/integrations/vercel';
import { transformSplunkOnCallToEvent } from '@/lib/integrations/splunk-oncall';
import { transformPagerDutyToEvent } from '@/lib/integrations/pagerduty';
import { transformGitHubToEvent, type GitHubEvent } from '@/lib/integrations/github';
import { verifyWebhookSignature } from '@/lib/integrations/signature-verification';
import {
  BetterUptimeSchema,
  GitHubEventSchema,
  VercelPayloadSchema,
  validatePayload,
} from '@/lib/integrations/schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('uptime providers', () => {
  it('Pingdom reads current_state and importance_level', () => {
    const down = transformPingdomToEvent({
      check_id: 77,
      check_name: 'Login',
      previous_state: 'UP',
      current_state: 'DOWN',
      importance_level: 'HIGH',
    });
    const up = transformPingdomToEvent({
      check_id: 77,
      previous_state: 'DOWN',
      current_state: 'UP',
    });
    expect(down.event_action).toBe('trigger');
    expect(down.payload.severity).toBe('critical');
    expect(up.event_action).toBe('resolve');
    expect(up.dedup_key).toBe(down.dedup_key);
    expect(transformPingdomToEvent({ check_id: 1, current_state: 'SUCCESS' }).event_action).toBe(
      'resolve'
    );
  });

  it('Better Stack JSON:API envelopes and string incident ids parse per incident', () => {
    const started = {
      data: { id: '42', type: 'incident', attributes: { name: 'API down', status: 'Started' } },
    };
    const resolved = {
      data: {
        id: '42',
        type: 'incident',
        attributes: { name: 'API down', resolved_at: '2026-01-01T00:00:00Z' },
      },
    };
    expect(validatePayload(BetterUptimeSchema, started).success).toBe(true);
    const a = transformBetterUptimeToEvent(started);
    const b = transformBetterUptimeToEvent(resolved);
    expect(a.event_action).toBe('trigger');
    expect(a.dedup_key).toBe('42');
    expect(a.payload.summary).toBe('API down');
    expect(b.event_action).toBe('resolve');
    expect(b.dedup_key).toBe('42');

    const stringIncident = { incident: '123456', name: 'Web', status: 'resolved' };
    expect(validatePayload(BetterUptimeSchema, stringIncident).success).toBe(true);
    const c = transformBetterUptimeToEvent(stringIncident);
    expect(c.dedup_key).toBe('123456');
    expect(c.event_action).toBe('resolve');
  });

  it('Uptime Kuma test notifications and PENDING/MAINTENANCE heartbeats do not page', () => {
    expect(
      transformUptimeKumaToEvent({ heartbeat: null, monitor: null, msg: 'Testing' })
    ).toBeNull();
    // A custom sender with only a top-level status still pages.
    expect(transformUptimeKumaToEvent({ status: 'down', msg: 'API down' })?.event_action).toBe(
      'trigger'
    );
    expect(
      transformUptimeKumaToEvent({ heartbeat: { status: 2 }, monitor: { id: 1, name: 'API' } })
    ).toBeNull();
    expect(
      transformUptimeKumaToEvent({ heartbeat: { status: 0 }, monitor: { id: 1, name: 'API' } })
        ?.event_action
    ).toBe('trigger');
  });

  it('UptimeRobot SSL expiry is a warning on its own key and paused is ignored', () => {
    const ssl = transformUptimeRobotToEvent({
      alertType: '3',
      monitorID: 9,
      monitorFriendlyName: 'Site',
    });
    expect(ssl?.event_action).toBe('trigger');
    expect(ssl?.payload.severity).toBe('warning');
    expect(ssl?.dedup_key).toBe('9-ssl');
    expect(transformUptimeRobotToEvent({ alertType: 'paused', monitorID: 9 })).toBeNull();
    expect(transformUptimeRobotToEvent({ alertType: '1', monitorID: 9 })?.dedup_key).toBe('9');
  });
});

describe('infrastructure monitors', () => {
  it('Nagios/Icinga CUSTOM and DOWNTIMEEND follow the state instead of acknowledging', () => {
    const base = { HOSTNAME: 'db', SERVICEDESC: 'pg', SERVICESTATE: 'CRITICAL' };
    expect(
      transformNagiosToEvent({ ...base, NOTIFICATIONTYPE: 'CUSTOM' } as any).event_action
    ).toBe('trigger');
    expect(
      transformNagiosToEvent({ ...base, NOTIFICATIONTYPE: 'DOWNTIMEEND' } as any).event_action
    ).toBe('trigger');
    expect(
      transformNagiosToEvent({ ...base, NOTIFICATIONTYPE: 'ACKNOWLEDGEMENT' } as any).event_action
    ).toBe('acknowledge');
    expect(
      transformIcingaToEvent({
        notification_type: 'Custom',
        host_name: 'db',
        service_name: 'pg',
        service_state: 'CRITICAL',
      } as any).event_action
    ).toBe('trigger');
  });

  it('Zabbix closing update resolves; unack does not acknowledge', () => {
    const closed = transformZabbixToEvent({
      event_id: '1',
      action: 'Update',
      status: 'RESOLVED',
    } as any);
    const unack = transformZabbixToEvent({
      event_id: '1',
      action: 'Unacknowledged',
      status: 'PROBLEM',
    } as any);
    expect(closed.event_action).toBe('resolve');
    expect(unack.event_action).toBe('trigger');
  });

  it('Zabbix subject-only problem and recovery share a dedup key', () => {
    const problem = transformZabbixToEvent({
      host_name: 'h',
      subject: 'Problem: Disk full',
    } as any);
    const recovery = transformZabbixToEvent({
      host_name: 'h',
      subject: 'Resolved in 5m 3s: Disk full',
      status: 'RESOLVED',
    } as any);
    expect(recovery.dedup_key).toBe(problem.dedup_key);
  });

  it('ManageEngine clear wins over a sticky acknowledged flag', () => {
    const event = transformManageEngineToEvent({
      alarmid: '5',
      stringseverity: 'Clear',
      acknowledged: 'true',
    } as any);
    expect(event.event_action).toBe('resolve');
  });

  it('ManageEngine array bodies keep every alarm', () => {
    const alarms = parseManageEngineAlarms(
      JSON.stringify([
        { alarmid: '1', message: 'CPU high', stringseverity: 'Critical' },
        { alarmid: '2', message: 'Disk full', stringseverity: 'Major' },
      ])
    );
    expect(alarms).toHaveLength(2);
    expect(new Set(alarms.map(a => transformManageEngineToEvent(a).dedup_key)).size).toBe(2);
    expect(parseManageEngineAlarms('{"alarmid":"3"}')).toHaveLength(1);
  });

  it('ManageEngine per-event ids do not split a trigger from its clear', () => {
    const trigger = transformManageEngineToEvent({
      deviceName: 'h1',
      eventId: 'e1',
      stringseverity: 'Critical',
    } as any);
    const clear = transformManageEngineToEvent({
      deviceName: 'h1',
      eventId: 'e2',
      stringseverity: 'Clear',
    } as any);
    expect(clear.dedup_key).toBe(trigger.dedup_key);
  });
});

describe('action word matching', () => {
  it('normalizeEventAction ignores negated words but keeps compound ones', () => {
    expect(normalizeEventAction('unresolved')).toBe('trigger');
    expect(normalizeEventAction('unacknowledged')).toBe('trigger');
    expect(normalizeEventAction('RECOVERY')).toBe('resolve');
    expect(normalizeEventAction('ACKNOWLEDGEMENT')).toBe('acknowledge');
    expect(normalizeEventAction('ACKED')).toBe('acknowledge');
  });

  it('generic webhook does not resolve or acknowledge on substrings', () => {
    expect(transformWebhookToEvent({ status: 'broken' }).event_action).toBe('trigger');
    expect(transformWebhookToEvent({ status: 'unresolved' }).event_action).toBe('trigger');
    expect(transformWebhookToEvent({ status: 'rollback' }).event_action).toBe('trigger');
    expect(transformWebhookToEvent({ status: 'ok' }).event_action).toBe('resolve');
    expect(transformWebhookToEvent({ status: 'acknowledged' }).event_action).toBe('acknowledge');
  });
});

describe('CI/CD providers', () => {
  it('Bitbucket reads commit_status.state and ignores non-status events', () => {
    const repo = { full_name: 'org/app' };
    expect(
      transformBitbucketToEvent({
        repository: repo,
        commit_status: { name: 'build', state: 'SUCCESSFUL' },
      }).event_action
    ).toBe('resolve');
    expect(
      transformBitbucketToEvent({
        repository: repo,
        commit_status: { name: 'build', state: 'FAILED' },
      }).event_action
    ).toBe('trigger');
    expect(
      transformBitbucketToEvent({
        repository: repo,
        commit_status: { name: 'build', state: 'INPROGRESS' },
      }).event_action
    ).toBe('acknowledge');
    expect(transformBitbucketToEvent({ repository: repo, push: {} }).event_action).toBe(
      'acknowledge'
    );
  });

  it('GitLab ordinary issues and manual pipelines do not page or resolve', () => {
    const project = { path_with_namespace: 'org/app' };
    expect(
      transformGitLabToEvent({
        object_kind: 'issue',
        project,
        object_attributes: { id: 1, action: 'update' },
      }).event_action
    ).toBe('acknowledge');
    expect(
      transformGitLabToEvent({
        object_kind: 'issue',
        project,
        object_attributes: { id: 2, action: 'open', issue_type: 'incident' },
      }).event_action
    ).toBe('trigger');
    expect(
      transformGitLabToEvent({
        object_kind: 'pipeline',
        project,
        object_attributes: { id: 3, ref: 'main', status: 'manual' },
      }).event_action
    ).toBe('acknowledge');
  });

  it('Vercel preview (target null) validates and never uses the production key', () => {
    const body = {
      type: 'deployment.error',
      payload: { project: { name: 'web' }, deployment: { id: 'd1' }, target: null },
    };
    expect(validatePayload(VercelPayloadSchema, body).success).toBe(true);
    const event = transformVercelToEvent(body as any);
    expect(event.payload.severity).toBe('error');
    expect(event.dedup_key).not.toContain('production');
  });

  it('GitHub deployment_status deliveries validate and share an environment key', () => {
    const failed = {
      repository: { name: 'app', full_name: 'org/app', html_url: 'https://x' },
      deployment: { id: 1, environment: 'production' },
      deployment_status: { state: 'failure' },
    };
    const succeeded = {
      ...failed,
      deployment: { id: 2, environment: 'production' },
      deployment_status: { state: 'success' },
    };
    expect(validatePayload(GitHubEventSchema, failed).success).toBe(true);
    const a = transformGitHubToEvent(failed as GitHubEvent);
    const b = transformGitHubToEvent(succeeded as GitHubEvent);
    expect(a.event_action).toBe('trigger');
    expect(b.event_action).toBe('resolve');
    expect(b.dedup_key).toBe(a.dedup_key);
  });

  it('GitHub check_run keys include the branch', () => {
    const check = (branch: string) =>
      transformGitHubToEvent({
        repository: { name: 'app', full_name: 'org/app', html_url: 'https://x' },
        check_run: {
          id: 1,
          name: 'build',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://x',
          check_suite: { head_branch: branch },
        },
      }).dedup_key;
    expect(check('main')).not.toBe(check('feature'));
  });
});

describe('incident-tool compat', () => {
  it('Splunk On-Call INFO is ignored', () => {
    expect(transformSplunkOnCallToEvent({ message_type: 'INFO', entity_id: 'e' })).toBeNull();
    expect(
      transformSplunkOnCallToEvent({ message_type: 'RECOVERY', entity_id: 'e' })?.event_action
    ).toBe('resolve');
  });

  it('PagerDuty triggers without dedup_key get unique keys, not summary keys', () => {
    const trigger = { event_action: 'trigger' as const, payload: { summary: 'Same' } };
    expect(transformPagerDutyToEvent(trigger).dedup_key).not.toBe(
      transformPagerDutyToEvent(trigger).dedup_key
    );
  });

  it('generic signature verification accepts Bitbucket X-Hub-Signature', () => {
    const body = '{"a":1}';
    const sig = `sha256=${crypto.createHmac('sha256', 's3cret').update(body).digest('hex')}`;
    expect(
      verifyWebhookSignature('generic', body, { 'x-hub-signature': sig }, 's3cret').valid
    ).toBe(true);
    expect(
      verifyWebhookSignature('generic', body, { 'x-hub-signature': 'sha256=00' }, 's3cret').valid
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { categorize } from '@/components/incident/detail/IncidentTimeline';

describe('IncidentTimeline categorize filter heuristic', () => {
  it('categorizes NOTIFICATION type directly into NOTIFICATIONS', () => {
    expect(categorize('NOTIFICATION', 'SMS notification delivered to OpsKnight Admin')).toBe(
      'NOTIFICATIONS'
    );
    expect(categorize('NOTIFICATION', 'Voice call notification delivered to OpsKnight Admin')).toBe(
      'NOTIFICATIONS'
    );
    expect(categorize('NOTIFICATION', 'WhatsApp notification delivered to OpsKnight Admin')).toBe(
      'NOTIFICATIONS'
    );
    expect(categorize('NOTIFICATION', 'Push notification sent to OpsKnight Admin')).toBe(
      'NOTIFICATIONS'
    );
    expect(categorize('NOTIFICATION', 'Microsoft Teams notification delivered to #general')).toBe(
      'NOTIFICATIONS'
    );
    expect(categorize('NOTIFICATION', 'Slack notification sent to #alerts')).toBe('NOTIFICATIONS');
  });

  it('categorizes legacy and narrative notification messages into NOTIFICATIONS', () => {
    expect(categorize('EVENT', 'Voice call connected to OpsKnight Admin (+917720833966)')).toBe(
      'NOTIFICATIONS'
    );
    expect(categorize('EVENT', 'Voice call attempt to +1234567890')).toBe('NOTIFICATIONS');
    expect(categorize('EVENT', 'SMS alert sent to on-call responder')).toBe('NOTIFICATIONS');
    expect(categorize('EVENT', 'WhatsApp notification delivered')).toBe('NOTIFICATIONS');
    expect(categorize('EVENT', 'Push notification sent to device')).toBe('NOTIFICATIONS');
    expect(categorize('EVENT', 'Card dispatched to Teams channel')).toBe('NOTIFICATIONS');
  });

  it('categorizes lifecycle, notes, escalation, assignment, and integrations correctly', () => {
    expect(categorize('NOTE', 'Checking the database logs')).toBe('NOTES');
    expect(categorize('COMMENT', 'Pinned summary')).toBe('NOTES');
    expect(categorize('CREATED', 'Incident triggered and created')).toBe('LIFECYCLE');
    expect(categorize('ACKNOWLEDGED', 'Incident acknowledged by responder')).toBe('LIFECYCLE');
    expect(categorize('RESOLVED', 'Incident marked as resolved')).toBe('LIFECYCLE');
    expect(categorize('EVENT', 'Incident escalated to Tier 2')).toBe('ESCALATION');
    expect(categorize('EVENT', 'Incident assigned to John Doe')).toBe('ASSIGNMENT');
    expect(categorize('EVENT', 'Jira issue PROJ-123 created')).toBe('INTEGRATIONS');
    expect(categorize('EVENT', 'Slack channel #inc-123 created')).toBe('INTEGRATIONS');
  });
});

import { expect, it } from 'vitest';
import { hasCapability, CAPABILITIES } from '@/lib/authorization';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';

it.each(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as const)(
  'applies actual %s capabilities before serializing duplicated source context',
  role => {
    const incident = {
      id: 'incident',
      description: '{"account":"private-account"}',
      automationDecision: { incidentId: 'incident' },
    };
    const sensitive = hasCapability(role, CAPABILITIES.INCIDENT_SENSITIVE_READ);
    const visible = visibleIncidentSource(incident, sensitive);
    expect(visible.description).toBe(sensitive ? incident.description : null);
    expect(JSON.stringify(visible).includes('private-account')).toBe(sensitive);
    expect(visible).not.toHaveProperty('automationDecision');
    expect(incident.description).toContain('private-account');
  }
);

it('preserves ordinary incident descriptions when no LIVE decision was recorded', () => {
  const incident = { id: 'ordinary', description: 'Operational details', automationDecision: null };
  expect(visibleIncidentSource(incident, false)).toEqual({
    id: 'ordinary',
    description: 'Operational details',
  });
});

it('redacts summary-derived title and retrigger text while preserving lifecycle events', () => {
  const incident = {
    title: 'Customer ABC123 payment failure',
    description: 'ABC123',
    automationDecision: { incidentId: 'incident' },
    events: [
      { id: 'source', message: 'Re-triggered by event from API. Summary: Customer ABC123' },
      { id: 'ack', message: 'Incident acknowledged' },
    ],
  };
  const visible = visibleIncidentSource(incident, false);
  expect(JSON.stringify(visible)).not.toContain('ABC123');
  expect(visible.events?.[1].message).toBe('Incident acknowledged');
  expect(visibleIncidentSource(incident, true).title).toBe(incident.title);
});

it('protects captured SHADOW source content even without a LIVE decision', () => {
  const visible = visibleIncidentSource(
    {
      title: 'private shadow summary',
      description: 'private',
      automationDecision: null,
      automationTraces: [{ incidentId: 'shadow' }],
    },
    false
  );
  expect(visible.title).toBe('Restricted alert content');
  expect(visible.description).toBeNull();
  expect(visible).not.toHaveProperty('automationTraces');
});

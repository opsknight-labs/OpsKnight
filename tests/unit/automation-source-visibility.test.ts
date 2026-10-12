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

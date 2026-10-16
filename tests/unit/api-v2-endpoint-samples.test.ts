/* eslint-disable @typescript-eslint/no-explicit-any -- arbitrary JSON documents / erased generic route plumbing */
import { describe, expect, it } from 'vitest';
import { ENDPOINT_SAMPLES, getVerifiedSampleBody } from '@/lib/api-v2/endpoint-samples';
import {
  IncidentCreateV2Schema,
  IncidentUpdateV2Schema,
  IncidentAcknowledgeV2Schema,
  IncidentResolveV2Schema,
  IncidentAssignV2Schema,
  IncidentNoteV2Schema,
  ServiceCreateV2Schema,
  ServiceUpdateV2Schema,
  TeamCreateV2Schema,
  TeamUpdateV2Schema,
  ScheduleCreateV2Schema,
  ScheduleUpdateV2Schema,
  ScheduleOverrideV2Schema,
  EscalationPolicyCreateV2Schema,
  EscalationPolicyUpdateV2Schema,
  IntegrationUpdateV2Schema,
  StatusPageCreateV2Schema,
  StatusPageUpdateV2Schema,
  StatusPageAnnouncementV2Schema,
  RunbookExecuteV2Schema,
  ServiceAccountCreateV2Schema,
  ServiceAccountTokenIssueV2Schema,
  PostmortemCreateV2Schema,
  PostmortemUpdateV2Schema,
} from '@/lib/api-v2/validation';

describe('API v2 Endpoint Verified Samples', () => {
  const schemaMap: Record<string, any> = {
    'POST /incidents': IncidentCreateV2Schema,
    'PATCH /incidents/{id}': IncidentUpdateV2Schema,
    'POST /incidents/{id}/acknowledge': IncidentAcknowledgeV2Schema,
    'POST /incidents/{id}/resolve': IncidentResolveV2Schema,
    'POST /incidents/{id}/assign': IncidentAssignV2Schema,
    'POST /incidents/{id}/notes': IncidentNoteV2Schema,
    'POST /services': ServiceCreateV2Schema,
    'PATCH /services/{id}': ServiceUpdateV2Schema,
    'POST /teams': TeamCreateV2Schema,
    'PATCH /teams/{id}': TeamUpdateV2Schema,
    'POST /schedules': ScheduleCreateV2Schema,
    'PATCH /schedules/{id}': ScheduleUpdateV2Schema,
    'POST /schedules/{id}/overrides': ScheduleOverrideV2Schema,
    'POST /escalation-policies': EscalationPolicyCreateV2Schema,
    'PATCH /escalation-policies/{id}': EscalationPolicyUpdateV2Schema,
    'PATCH /integrations/{id}': IntegrationUpdateV2Schema,
    'POST /status-pages': StatusPageCreateV2Schema,
    'PATCH /status-pages/{id}': StatusPageUpdateV2Schema,
    'POST /status-pages/{id}/announcements': StatusPageAnnouncementV2Schema,
    'POST /runbooks/{id}/execute': RunbookExecuteV2Schema,
    'POST /service-accounts': ServiceAccountCreateV2Schema,
    'POST /service-accounts/{id}/tokens': ServiceAccountTokenIssueV2Schema,
    'POST /postmortems': PostmortemCreateV2Schema,
    'PATCH /postmortems/{id}': PostmortemUpdateV2Schema,
  };

  for (const [endpointKey, schema] of Object.entries(schemaMap)) {
    it(`certifies sample body for ${endpointKey} conforms to its Zod schema`, () => {
      const [method, path] = endpointKey.split(' ');
      const sample = getVerifiedSampleBody(method, path);
      expect(sample).toBeDefined();

      const parsed = schema.safeParse(sample);
      if (!parsed.success) {
        // Output detailed failure reason if any
        console.error(`Validation failed for ${endpointKey}:`, parsed.error.issues);
      }
      expect(parsed.success).toBe(true);
    });
  }

  it('retains samples for every established request body', () => {
    expect(Object.keys(ENDPOINT_SAMPLES).length).toBeGreaterThanOrEqual(
      Object.keys(schemaMap).length
    );
  });
});

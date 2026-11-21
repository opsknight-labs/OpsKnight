import { describe, expect, it } from 'vitest';
import { loadCompiledVersion, checksum } from '@/lib/automation/cache';
import { compileAutomation } from '@/lib/automation/compiler';
import {
  noiseFirstInputs,
  outcomeOf,
  reevaluateNoiseFirst,
  rerouteBlocker,
} from '@/lib/automation/pipeline';
import {
  describeNoiseDecisions,
  describePipeline,
} from '@/lib/automation/presentation/pipeline-trace';
import type { IntegrationEventEnvelope, RuntimeEvaluation } from '@/lib/automation/runtime';
import { compilePolicy } from '@/lib/intelligence/noise-controls/cache';

const envelope: IntegrationEventEnvelope = {
  serviceId: 'svc',
  integrationId: 'int',
  integrationType: 'EVENTS_API',
  event: {
    event_action: 'trigger',
    dedup_key: 'k',
    payload: {
      summary: 'Replication lag',
      source: 'pgwatch',
      severity: 'error',
      custom_details: { region: 'eu' },
    },
  },
  providerPayload: {},
  receivedAt: new Date('2026-11-17T12:00:00Z'),
};
const classification = { priority: 'P2', urgency: 'HIGH' };

function liveRuntime(overrides: Partial<RuntimeEvaluation> = {}): RuntimeEvaluation {
  return {
    mode: 'LIVE',
    versionId: null,
    versionNumber: 1,
    contextFields: [],
    evaluationAt: envelope.receivedAt,
    durationMs: 0,
    extractionMs: 0,
    versionLoadMs: 0,
    evaluatorMs: 0,
    policyLookupMs: 0,
    responderSnapshotMs: 0,
    result: {
      outcome: { type: 'SERVICE_DEFAULT' },
      matchedRule: null,
    } as unknown as RuntimeEvaluation['result'],
    fallbackReason: null,
    shadowDifferent: false,
    basePriority: 'P2',
    finalPriority: 'P2',
    policyId: 'default-policy',
    policyName: 'Default',
    observations: [],
    normalization: [],
    ...overrides,
  };
}

describe('pipeline order (J1.5)', () => {
  it('leaves automation inputs untouched (same objects) when the noise decision changed nothing', () => {
    const inputs = noiseFirstInputs(envelope, classification, undefined, 'HIGH');
    expect(inputs.envelope).toBe(envelope);
    expect(inputs.classification).toBe(classification);
  });

  it('gives automation the transformed severity, urgency and labels without mutating the event', () => {
    const inputs = noiseFirstInputs(
      envelope,
      classification,
      { severity: 'info', labels: { team: 'dba' } },
      'LOW'
    );
    expect(inputs.envelope.event.payload.severity).toBe('info');
    expect(inputs.envelope.event.payload.custom_details).toEqual({ region: 'eu', team: 'dba' });
    expect(inputs.classification).toEqual({ priority: 'P2', urgency: 'LOW' });
    expect(envelope.event.payload.severity).toBe('error');
    expect(envelope.event.payload.custom_details).toEqual({ region: 'eu' });
  });

  it('re-evaluates the cached version on noise-first inputs (pure SHADOW comparison)', () => {
    const { compiled } = compileAutomation({
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'quiet-info',
          name: 'Info is P5',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'severity', operator: 'EQ', value: 'info' }],
          actions: [{ type: 'SET_PRIORITY', value: 'P5' }],
        },
      ],
    });
    loadCompiledVersion({
      id: 'pipeline-v1',
      compiledSnapshot: compiled,
      checksum: checksum(compiled),
      versionNumber: 1,
    });
    const runtime = liveRuntime({ versionId: 'pipeline-v1' });
    const inputs = noiseFirstInputs(envelope, classification, { severity: 'info' }, 'HIGH');
    const result = reevaluateNoiseFirst(runtime, inputs.envelope, inputs.classification);
    expect(outcomeOf(result, 'P2', 'default-policy')).toEqual({
      priority: 'P5',
      route: 'SERVICE_DEFAULT',
      policyId: 'default-policy',
    });
    // Nothing comparable: a fallback, or no version.
    expect(
      reevaluateNoiseFirst(
        liveRuntime({ versionId: 'pipeline-v1', fallbackReason: 'X' }),
        envelope,
        classification
      )
    ).toBeNull();
    expect(reevaluateNoiseFirst(null, envelope, classification)).toBeNull();
  });

  it('lets a reroute replace only a live, rule-less service-default route', () => {
    expect(rerouteBlocker(null)).toBe('AUTOMATION_NOT_LIVE');
    expect(rerouteBlocker(liveRuntime({ mode: 'SHADOW' }))).toBe('AUTOMATION_NOT_LIVE');
    expect(rerouteBlocker(liveRuntime({ fallbackReason: 'VERSION_MISSING' }))).toBe(
      'AUTOMATION_NOT_LIVE'
    );
    expect(rerouteBlocker(liveRuntime())).toBeNull();
    expect(
      rerouteBlocker(
        liveRuntime({
          result: {
            outcome: { type: 'SERVICE_DEFAULT' },
            matchedRule: { id: 'r', name: 'Use default' },
          } as unknown as RuntimeEvaluation['result'],
        })
      )
    ).toBe('AUTOMATION_ROUTE_RULE');
    expect(
      rerouteBlocker(
        liveRuntime({
          result: {
            outcome: { type: 'NO_ESCALATION' },
            matchedRule: null,
          } as unknown as RuntimeEvaluation['result'],
        })
      )
    ).toBe('AUTOMATION_ROUTE_RULE');
  });

  it('reads the per-scope order from the policy row, OFF unless the policy itself is active', () => {
    const row = { scopeKey: 'service:svc', serviceId: 'svc', revision: 1, definition: {} };
    expect(compilePolicy({ ...row, mode: 'ON' }).pipelineOrder).toBe('OFF');
    expect(compilePolicy({ ...row, mode: 'ON', pipelineOrder: 'SHADOW' }).pipelineOrder).toBe(
      'SHADOW'
    );
    expect(compilePolicy({ ...row, mode: 'SHADOW', pipelineOrder: 'ON' }).pipelineOrder).toBe('ON');
    expect(compilePolicy({ ...row, mode: 'OFF', pipelineOrder: 'ON' }).pipelineOrder).toBe('OFF');
  });

  it('explains both decisions in one trace', () => {
    expect(describePipeline({})).toEqual([]);
    expect(
      describePipeline({ pipeline: { order: 'ON', automation: 'SKIPPED' } }).map(s => s.text)
    ).toEqual(['Noise controls ran first; automation did no work for this alert.']);
    const shadow = describePipeline({
      pipeline: {
        order: 'SHADOW',
        automation: {
          actual: { priority: 'P2', route: 'SERVICE_DEFAULT', policyId: 'a' },
          noiseFirst: { priority: 'P5', route: 'SERVICE_DEFAULT', policyId: 'a' },
          different: true,
        },
        reroute: { serviceId: 'svc-2', wouldApply: true },
        attachRunbookIds: ['rb-1'],
      },
    }).map(s => s.text);
    expect(shadow).toEqual([
      'With noise controls first, automation would have chosen the service default, priority P5 instead of the service default, priority P2.',
      "An orchestration rule would have routed responders to service svc-2's policy.",
      'An orchestration rule would have suggested 1 runbook(s) bound to this service.',
    ]);
    const applied = describeNoiseDecisions([
      {
        control: 'ORCHESTRATION',
        action: 'TRANSFORM',
        mode: 'ON',
        applied: true,
        reason: 'Transformed by orchestration rules',
        sourceName: null,
        reversedAt: null,
        evidence: {
          pipeline: {
            order: 'ON',
            automation: { priority: 'P5', route: 'ESCALATION_POLICY', policyId: 'b' },
            reroute: {
              serviceId: 'svc-2',
              serviceName: 'Database',
              applied: true,
              reason: 'APPLIED',
            },
          },
        },
      },
    ]).map(s => s.text);
    expect(applied).toEqual([
      'Noise controls: Transformed by orchestration rules.',
      'Noise controls ran first; automation then chose a selected policy, priority P5.',
      "An orchestration rule routed responders to service “Database”'s escalation policy.",
    ]);
  });
});

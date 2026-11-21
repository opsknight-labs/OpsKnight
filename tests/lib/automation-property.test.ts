import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileAutomation } from '@/lib/automation/compiler';
import { evaluateAutomation } from '@/lib/automation/evaluator';
import { evaluateOperator } from '@/lib/automation/evaluator/operators';
import { emptySnapshot, PRIORITIES, type Context } from '@/lib/automation/contract';
import { builtinContext } from '@/lib/automation/context/builtins';
import { extractContext } from '@/lib/automation/context/extract';
import {
  replayEvent,
  replayEvents,
  type ReplayEnvironment,
  type ReplayEvent,
} from '@/lib/automation/replay';
it('keeps negative comparisons unknown across missing and unmapped input families', () => {
  for (let seed = 0; seed < 250; seed++)
    for (const operator of ['NE', 'NOT_IN'] as const) {
      for (const field of [
        { state: 'MISSING' as const },
        { state: 'UNMAPPED' as const, raw: `unknown-${seed}` },
      ])
        expect(
          evaluateOperator(field, {
            fieldKey: 'source',
            operator,
            value: operator === 'NE' ? `value-${seed}` : [`value-${seed}`],
          })
        ).toBe('UNKNOWN');
    }
});
it('is deterministic across generated priorities, conditions and rule orders', () => {
  for (let seed = 0; seed < 100; seed++) {
    const { compiled } = compileAutomation({
      ...emptySnapshot,
      rules: [
        {
          id: 'enrich',
          name: 'Priority',
          enabled: true,
          phase: 'ENRICH',
          conditions: [],
          actions: [{ type: 'SET_PRIORITY', value: ['P1', 'P2', 'P3', 'P4', 'P5'][seed % 5] }],
        },
        {
          id: 'route',
          name: 'Route',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'priority', operator: 'IN', value: ['P1', 'P2'] }],
          actions: [{ type: 'USE_SERVICE_DEFAULT' }],
        },
      ],
    });
    const context: Context = {
      priority: seed % 2 ? { state: 'MISSING' } : { state: 'RECOGNIZED', value: 'P3' },
    };
    const before = structuredClone(context);
    const input = {
      version: compiled,
      initialContext: context,
      evaluationAt: '2026-10-07T00:00:00Z',
    };
    expect(evaluateAutomation(input)).toEqual(evaluateAutomation(input));
    expect(context).toEqual(before);
  }
});
it('replays stored events to exactly what live evaluation decides for them', () => {
  const severities = ['critical', 'error', 'warning', 'info'] as const;
  const environment: ReplayEnvironment = {
    integrationType: 'EVENTS_API_V2',
    defaultPolicyId: 'default-policy',
    classify: severity => ({
      priority: severity === 'critical' ? 'P1' : severity === 'info' ? null : 'P3',
      urgency: severity === 'critical' ? 'HIGH' : 'LOW',
    }),
  };
  for (let seed = 0; seed < 100; seed++) {
    const { compiled, issues } = compileAutomation({
      schemaVersion: 1,
      fields: [
        {
          fieldId: 'env',
          key: 'env',
          label: 'Environment',
          type: 'ENUM',
          allowedValues: ['prod', 'staging'],
          mappings: [{ source: 'EVENT', path: 'payload.custom_details.env' }],
        },
      ],
      rules: [
        {
          id: 'raise',
          name: 'Raise',
          phase: 'ENRICH',
          enabled: seed % 7 !== 0,
          conditions: [{ fieldKey: 'env', operator: 'EQ', value: 'prod' }],
          actions: [
            { type: 'SET_PRIORITY', value: PRIORITIES[seed % 5] },
            { type: 'ADD_TAG', value: `tag-${seed % 3}` },
          ],
        },
        {
          id: 'quiet',
          name: 'Quiet',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'severity', operator: 'EQ', value: severities[seed % 4] }],
          actions: [{ type: 'NO_ESCALATION' }],
        },
        {
          id: 'urgent',
          name: 'Urgent',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'priority', operator: 'IN', value: ['P1', 'P2'] }],
          actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'urgent-policy' }],
        },
        {
          id: 'dead',
          name: 'Dead',
          phase: 'ROUTE',
          enabled: true,
          conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'never-seen' }],
          actions: [{ type: 'USE_SERVICE_DEFAULT' }],
        },
      ],
    });
    expect(issues.filter(issue => issue.level === 'ERROR')).toEqual([]);
    const live: unknown[] = [];
    const events: ReplayEvent[] = Array.from({ length: 12 }, (_, index) => {
      const severity = severities[(seed + index) % 4];
      const event = {
        event_action: 'trigger' as const,
        dedup_key: `k-${seed}-${index}`,
        payload: {
          summary: 'x',
          source: `source-${index % 3}`,
          severity,
          custom_details: { env: ['prod', 'staging', 'qa', undefined][(seed * 3 + index) % 4] },
        },
      };
      // Live path: the context exactly as prepareAutomation builds it, then the pure evaluator.
      const context = extractContext({
        fields: compiled.fields,
        providerPayload: event,
        normalizedEvent: event,
        integrationType: environment.integrationType,
      });
      Object.assign(
        context,
        builtinContext({
          ...environment.classify(severity),
          severity,
          integrationType: environment.integrationType,
          source: event.payload.source,
        })
      );
      const at = new Date(Date.UTC(2026, 9, 1 + (index % 7))).toISOString();
      const decided = evaluateAutomation({
        version: compiled,
        initialContext: context,
        evaluationAt: at,
      });
      live.push(decided);
      const priority = decided.enrichedContext.priority;
      return {
        incidentId: `i-${index}`,
        at,
        event,
        actual: {
          route: decided.outcome,
          policyId:
            decided.outcome.type === 'ESCALATION_POLICY'
              ? decided.outcome.policyId
              : decided.outcome.type === 'NO_ESCALATION'
                ? null
                : environment.defaultPolicyId,
          priority: priority?.state === 'RECOGNIZED' ? String(priority.value) : null,
        },
      };
    });
    expect(events.map(event => replayEvent(compiled, event, environment).result)).toEqual(live);
    const summary = replayEvents(compiled, events, environment);
    expect(summary).toMatchObject({
      eventsEvaluated: events.length,
      same: events.length,
      routeChanged: 0,
      priorityChanged: 0,
      fallbacks: 0,
    });
    expect(summary.rules.find(rule => rule.ruleId === 'dead')?.matched).toBe(0);
    expect(replayEvents(compiled, events, environment)).toEqual(summary);
  }
});
it('has no IO or clock access inside the pure evaluation modules', () => {
  for (const file of ['index', 'enrich', 'route', 'conditions', 'operators']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed evaluator module names above.
    const source = readFileSync(`src/lib/automation/evaluator/${file}.ts`, 'utf8');
    expect(source).not.toMatch(
      /prisma|fetch\(|axios|https?:|process\.env|Date\.now|performance\.now|from ['"](?:fs|node:fs|crypto|node:crypto)/
    );
  }
});

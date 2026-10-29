import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  classifyEscalationSteps,
  type EscalationJobRow,
} from '@/lib/escalation/execution-health';
import EscalationExecutionHealth from '@/components/incident/detail/EscalationExecutionHealth';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 4, minute));
const job = (stepIndex: number, status: string, extra: Partial<EscalationJobRow> = {}) => ({
  stepIndex,
  status,
  attempts: status === 'FAILED' ? 3 : 1,
  maxAttempts: 3,
  error: status === 'FAILED' ? 'Job timed out in PROCESSING state after exceeding maxAttempts' : null,
  failedAt: status === 'FAILED' ? at(46) : null,
  completedAt: status === 'COMPLETED' ? at(36) : null,
  createdAt: at(30 + stepIndex),
  ...extra,
});

describe('escalation execution health', () => {
  it('keeps a failed step visible after a later step completes', () => {
    const health = classifyEscalationSteps({
      generation: 0,
      incidentEscalationStatus: 'COMPLETED',
      jobs: [job(0, 'COMPLETED'), job(1, 'FAILED'), job(2, 'COMPLETED')],
      timelineLevels: new Set([1, 3]),
      targetLabels: ['Primary on-call', 'Secondary on-call', 'Engineering manager'],
    });

    const failed = health.steps.find(step => step.stepNumber === 2)!;
    expect(failed).toMatchObject({
      outcome: 'FAILED',
      continuedAfter: true,
      attempts: 3,
      maxAttempts: 3,
      targetLabel: 'Secondary on-call',
      timelineEvidence: false,
    });
    expect(health.steps.find(step => step.stepNumber === 3)?.outcome).toBe('COMPLETED');
    expect(health.needsAttention).toBe(true);

    const html = renderToStaticMarkup(<EscalationExecutionHealth health={health} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Step 2');
    expect(html).toContain('Secondary on-call');
    expect(html).toContain('Failed');
    expect(html).toContain('Later steps continued');
    expect(html).toContain('not retried automatically');
  });

  it('marks a failed job whose page reached the timeline as uncertain, not failed', () => {
    const health = classifyEscalationSteps({
      generation: 0,
      incidentEscalationStatus: 'ESCALATING',
      jobs: [job(0, 'FAILED')],
      timelineLevels: new Set([1]),
    });
    expect(health.steps[0]).toMatchObject({ outcome: 'UNCERTAIN', timelineEvidence: true });
    expect(health.needsAttention).toBe(true);
    expect(renderToStaticMarkup(<EscalationExecutionHealth health={health} />)).toContain(
      'Check the notification records before resending'
    );
  });

  it('prefers the completed job when a step has several rows', () => {
    const health = classifyEscalationSteps({
      generation: 1,
      incidentEscalationStatus: 'COMPLETED',
      jobs: [job(0, 'FAILED'), job(0, 'COMPLETED', { createdAt: at(50) })],
      timelineLevels: new Set(),
    });
    expect(health.steps).toHaveLength(1);
    expect(health.steps[0].outcome).toBe('COMPLETED');
    expect(health.needsAttention).toBe(false);
  });

  it('renders no alert for a healthy run and nothing for an incident without escalation', () => {
    const healthy = classifyEscalationSteps({
      generation: 0,
      incidentEscalationStatus: 'COMPLETED',
      jobs: [job(0, 'COMPLETED')],
      timelineLevels: new Set([1]),
    });
    expect(renderToStaticMarkup(<EscalationExecutionHealth health={healthy} />)).not.toContain(
      'role="alert"'
    );
    const none = classifyEscalationSteps({
      generation: 0,
      incidentEscalationStatus: null,
      jobs: [],
      timelineLevels: new Set(),
    });
    expect(renderToStaticMarkup(<EscalationExecutionHealth health={none} />)).toBe('');
  });

  it('flags an incident whose escalation execution itself failed', () => {
    const health = classifyEscalationSteps({
      generation: 0,
      incidentEscalationStatus: 'FAILED',
      jobs: [],
      timelineLevels: new Set(),
    });
    expect(health.needsAttention).toBe(true);
    expect(renderToStaticMarkup(<EscalationExecutionHealth health={health} />)).toContain(
      'Escalation for this incident has failed'
    );
  });
});

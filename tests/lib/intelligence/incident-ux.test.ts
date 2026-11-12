import { describe, expect, it } from 'vitest';
import {
  explainNoiseDecision,
  incidentRef,
  noiseBadgeKind,
  noiseBadgeLabel,
} from '@/lib/intelligence/incident-ux/explain';
import { formatSummaryAsNote } from '@/lib/intelligence/incident-ux/summary-note';

describe('explainNoiseDecision', () => {
  it('names the rule or window and explains why', () => {
    const suppressed = explainNoiseDecision({
      control: 'SUPPRESSION',
      action: 'SUPPRESS',
      mode: 'ON',
      applied: true,
      sourceName: 'Known noisy probe',
      reason: 'Matched probe=synthetic',
      evidence: { threshold: 3, nested: { ignored: true }, long: 'x'.repeat(80) },
    });
    expect(suppressed.title).toBe('Suppressed by rule “Known noisy probe”');
    expect(suppressed.why).toEqual(['Matched probe=synthetic', 'Threshold: 3']);
    expect(suppressed.reversalPages).toBe(true);

    expect(
      explainNoiseDecision({
        control: 'MAINTENANCE',
        action: 'DOWNGRADE',
        mode: 'ON',
        applied: true,
        sourceName: 'DB upgrade',
        reason: 'Window active',
      }).title
    ).toBe('Urgency lowered: in maintenance window “DB upgrade”');
    const grouped = explainNoiseDecision({
      control: 'STORM',
      action: 'GROUP_CHILD',
      mode: 'ON',
      applied: true,
      sourceName: null,
      reason: 'Storm',
      evidence: { recentIncidents: 9, topology: true },
    });
    expect(grouped.title).toBe('Grouped into parent incident');
    expect(grouped.why).toContain('Incidents in the window: 9');
    expect(grouped.why).toContain('Topology-aware: yes');
    expect(
      explainNoiseDecision({
        control: 'CONTENT_DEDUP',
        action: 'APPEND',
        mode: 'ON',
        applied: true,
        sourceName: null,
        reason: 'Same content',
      }).title
    ).toBe('Deduplicated into this incident');
  });

  it('marks shadow decisions as changing nothing and not paging on reversal', () => {
    const shadow = explainNoiseDecision({
      control: 'SUPPRESSION',
      action: 'SUPPRESS',
      mode: 'SHADOW',
      applied: false,
      sourceName: 'Rule A',
      reason: 'r',
      reversedAt: new Date(),
    });
    expect(shadow.title).toBe('Shadow: would have been suppressed by rule “Rule A”');
    expect(shadow.why.join(' ')).toMatch(/nothing was changed/);
    expect(shadow.why).toContain('An operator reversed this decision.');
    expect(shadow.reversalPages).toBe(false);
  });

  it('maps controls to list badges', () => {
    expect(noiseBadgeKind('MAINTENANCE')).toBe('maintenance');
    expect(noiseBadgeKind('SUPPRESSION')).toBe('suppressed');
    expect(noiseBadgeKind('STORM')).toBeNull();
    expect(noiseBadgeLabel('SUPPRESSION', 'Probe')).toBe('Suppressed by Probe');
    expect(noiseBadgeLabel('MAINTENANCE', null)).toBe('In maintenance');
    expect(noiseBadgeLabel('FLAPPING', null)).toBe('Suppressed: flapping');
    expect(incidentRef('cl1234abcde')).toBe('#ABCDE');
  });
});

describe('formatSummaryAsNote', () => {
  it('renders the summary as a plain-text note that says where it came from', () => {
    const note = formatSummaryAsNote(
      {
        headline: 'Checkout failing',
        currentState: 'Rolling back.',
        impact: 'EU customers',
        keyEvents: ['Deploy 10:00', 'Errors 10:02'],
        possibleCauses: [],
        nextSteps: ['Confirm rollback'],
      },
      { kind: 'ai', model: 'model-x' }
    );
    expect(note).toBe(
      [
        'Summary: Checkout failing',
        '',
        'Rolling back.',
        '',
        'Impact: EU customers',
        '',
        'Key events:',
        '- Deploy 10:00',
        '- Errors 10:02',
        '',
        'Suggested next steps:',
        '- Confirm rollback',
        '',
        '(AI-generated summary by model-x, posted by a responder. Verify before relying on it.)',
      ].join('\n')
    );
  });
});

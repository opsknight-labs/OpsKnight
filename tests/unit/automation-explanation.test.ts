import { describe, expect, it } from 'vitest';
import {
  encodeExplanation,
  decodeExplanation,
  MAX_AUTOMATION_DECISION_BYTES,
} from '@/lib/automation/explanation';

describe('bounded Automation explanations', () => {
  it('interns repeated long raw values and restores the existing explanation shape', () => {
    const raw = 'customer-'.repeat(220);
    const input = {
      normalization: [{ raw, canonical: { state: 'UNMAPPED', raw } }],
      inputContext: { customer: { state: 'UNMAPPED', raw } },
      enrichedContext: { customer: { state: 'UNMAPPED', raw } },
    };
    const encoded = encodeExplanation(input, MAX_AUTOMATION_DECISION_BYTES);
    expect(encoded.valueTable).toEqual([raw]);
    expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(input).length / 2);
    expect(decodeExplanation(encoded)).toMatchObject(input);
  });
  it('bounds worst-case escaped fields and distinct enrichment writes without losing the responder snapshot', () => {
    const responderPolicy = {
      id: 'policy',
      name: 'Pinned policy',
      steps: [{ id: 'step', delayMinutes: 5, notificationChannels: ['VOICE'] }],
    };
    const input = {
      responderPolicy,
      outcome: { type: 'USE_ESCALATION_POLICY', policyId: 'policy' },
      inputContext: Object.fromEntries(
        Array.from({ length: 64 }, (_, i) => [
          `field_${i}`,
          { state: 'UNMAPPED', raw: `${i}${'\u0001'.repeat(2040)}` },
        ])
      ),
      writes: Array.from({ length: 800 }, (_, i) => ({
        fieldKey: `field_${i % 64}`,
        value: `${i}${'x'.repeat(2000)}`,
      })),
    };
    const encoded = encodeExplanation(input, MAX_AUTOMATION_DECISION_BYTES);
    expect(Buffer.byteLength(JSON.stringify(encoded))).toBeLessThanOrEqual(
      MAX_AUTOMATION_DECISION_BYTES
    );
    expect(encoded.responderPolicy).toEqual(responderPolicy);
    expect(encoded.outcome).toEqual(input.outcome);
    expect(encoded.omittedValues).not.toEqual([]);
  });
  it('preserves legacy explanations without an encoding marker', () => {
    const input = { inputContext: { priority: { state: 'RECOGNIZED', value: 'P1' } } };
    expect(decodeExplanation(input)).toBe(input);
  });
});

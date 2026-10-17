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
  it('accounts exactly for escaped UTF-8 values and multi-digit omitted indexes', () => {
    const input = {
      outcome: { type: 'SERVICE_DEFAULT' },
      writes: Array.from({ length: 32 }, (_, i) => `${i}😀\n${'é'.repeat(300)}`),
    };
    const full = encodeExplanation(input, 100000);
    const values = [...(full.valueTable as string[])];
    const expected = {
      ...full,
      valueTable: values as Array<string | null>,
      omittedValues: [] as number[],
    };
    const budget = Buffer.byteLength(JSON.stringify(full), 'utf8') - 4500;
    for (
      let i = values.length - 1;
      Buffer.byteLength(JSON.stringify(expected), 'utf8') > budget;
      i--
    ) {
      expected.valueTable.splice(i, 1, null);
      expected.omittedValues.push(i);
    }
    expect(encodeExplanation(input, budget)).toEqual(expected);
    expect(Buffer.byteLength(JSON.stringify(expected), 'utf8')).toBeLessThanOrEqual(budget);
  });

  it('preserves legacy explanations without an encoding marker', () => {
    const input = { inputContext: { priority: { state: 'RECOGNIZED', value: 'P1' } } };
    expect(decodeExplanation(input)).toBe(input);
  });
});

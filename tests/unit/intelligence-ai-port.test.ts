// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  dataClassAllows,
  registerLanguageModelResolver,
  resolveLanguageModel,
} from '@/lib/intelligence/ai/port';

afterEach(() => registerLanguageModelResolver(async () => null));

describe('language model port', () => {
  it('reports AI as unavailable until a gateway registers', async () => {
    expect(await resolveLanguageModel('SQUIRE_CHAT', 'INTERNAL')).toBeNull();
  });

  it('degrades to unavailable when the gateway throws', async () => {
    registerLanguageModelResolver(async () => {
      throw new Error('gateway exploded');
    });
    expect(await resolveLanguageModel('SUMMARIZE', 'INTERNAL')).toBeNull();
  });

  it('orders data classes from least to most sensitive', () => {
    expect(dataClassAllows('SENSITIVE', 'PERSONAL')).toBe(true);
    expect(dataClassAllows('INTERNAL', 'INTERNAL')).toBe(true);
    expect(dataClassAllows('INTERNAL', 'PERSONAL')).toBe(false);
    expect(dataClassAllows('PUBLIC', 'SENSITIVE')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { CostBudget } from '@/lib/mcp/core/budget';

describe('CostBudget.consumeResult', () => {
  it('keeps a committed write a success when the client cancelled before the result was recorded', () => {
    const controller = new AbortController();
    const budget = new CostBudget(8, 262144, controller.signal);
    controller.abort();

    expect(() => budget.consumeResult({ data: { id: 'created' } })).not.toThrow();
  });

  it('keeps a committed write a success when the deadline passed before the result was recorded', () => {
    const budget = new CostBudget(8, 262144, undefined, -1);

    expect(() => budget.consumeResult({ data: { id: 'created' } })).not.toThrow();
  });

  it('still stops new work after a cancel or the deadline', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => new CostBudget(8, 262144, controller.signal).consumeOperation()).toThrow();
    expect(() => new CostBudget(8, 262144, undefined, -1).consumeOperation()).toThrow();
  });

  it('still refuses a result over the byte budget', () => {
    expect(() => new CostBudget(8, 10).consumeResult({ data: 'x'.repeat(100) })).toThrow();
  });
});

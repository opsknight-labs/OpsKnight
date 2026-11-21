import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { withRollingCacheBreakpoint } from '@/lib/intelligence/ai/gateway';
import {
  estimateCacheReads,
  MIN_CACHEABLE_PREFIX_TOKENS,
} from '@/lib/intelligence/ai/cache-estimate';
import { compactToolSchema } from '@/lib/intelligence/ai/port';

const tools = [
  { type: 'function', function: { name: 'get_incident', description: 'x'.repeat(5000) } },
];
const system = { role: 'system', content: 'rules '.repeat(200) };
const user = { role: 'user', content: 'Why is checkout failing?' };
const call = {
  role: 'assistant',
  content: null,
  tool_calls: [{ function: { name: 'get_incident' } }],
};
const result = { role: 'tool', content: '{"status":"OPEN"}' };

describe('offline prompt-cache estimate', () => {
  it('reads nothing on the first request and the shared prefix on each later step', () => {
    const step1 = { tools, messages: [system, user] };
    const step2 = { tools, messages: [system, user, call, result] };
    const estimate = estimateCacheReads([step1, step2]);
    expect(estimate.perStep[0]).toBe(0);
    const prefix =
      Math.ceil(JSON.stringify(tools).length / 4) +
      Math.ceil(JSON.stringify(system).length / 4) +
      Math.ceil(JSON.stringify(user).length / 4);
    expect(estimate.perStep[1]).toBe(prefix);
    expect(estimate.cacheReadTokens).toBe(prefix);
    expect(estimate.cacheReadTokens).toBeLessThan(estimate.inputTokens);
  });

  it('reads nothing after the tool catalogue changes, or when the prefix is below the provider minimum', () => {
    const other = [{ type: 'function', function: { name: 'list_alerts' } }];
    expect(
      estimateCacheReads([
        { tools, messages: [system] },
        { tools: other, messages: [system] },
      ]).perStep
    ).toEqual([0, 0]);
    const tiny = { messages: [user] };
    expect(estimateCacheReads([tiny, tiny]).perStep).toEqual([0, 0]);
    expect(MIN_CACHEABLE_PREFIX_TOKENS).toBe(1024);
  });

  it('matches the gateway markers: each step marks its newest message, and the next step keeps that prefix', () => {
    const anthropic = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    const base: ModelMessage[] = [
      { role: 'system', content: 'rules', providerOptions: anthropic },
      { role: 'user', content: 'Why is checkout failing?' },
    ];
    const grown: ModelMessage[] = [
      ...base,
      { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }] },
      { role: 'user', content: 'And the logs?' },
    ];
    const first = withRollingCacheBreakpoint(base, 'ANTHROPIC');
    const second = withRollingCacheBreakpoint(grown, 'ANTHROPIC');
    // The breakpoint of step one sits on its last message; step two starts with the same unmarked messages.
    expect(first.at(-1)?.providerOptions).toEqual(anthropic);
    expect(second[0]).toEqual(first[0]);
    expect(second[1]).toEqual(base[1]);
    expect(second.at(-1)?.providerOptions).toEqual(anthropic);
  });
});

describe('compact tool schemas', () => {
  it('drops advisory bounds and keeps what defines a valid call', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 64 },
        resolution: { type: 'string', minLength: 10, maxLength: 1000 },
        // A field may be called like a keyword; it is a name, not a keyword.
        default: { type: 'integer', minimum: 1, maximum: 15, default: 15 },
        kind: { type: 'string', enum: ['A', 'B'] },
        tags: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', maxLength: 20 } },
      },
      required: ['id', 'resolution'],
      additionalProperties: false,
    };
    expect(compactToolSchema(schema)).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        resolution: { type: 'string', minLength: 10 },
        default: { type: 'integer', minimum: 1, maximum: 15 },
        kind: { type: 'string', enum: ['A', 'B'] },
        tags: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      required: ['id', 'resolution'],
    });
  });
});

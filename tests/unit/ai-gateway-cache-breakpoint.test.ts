import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { withRollingCacheBreakpoint } from '@/lib/intelligence/ai/gateway';

const anthropic = { anthropic: { cacheControl: { type: 'ephemeral' } } };
const step: ModelMessage[] = [
  { role: 'system', content: 'rules', providerOptions: anthropic },
  { role: 'user', content: 'Why is checkout failing?' },
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'get_incident', input: {} }],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'get_incident',
        output: { type: 'text', value: '{}' },
      },
    ],
  },
];
const marked = (messages: ModelMessage[]) =>
  messages.map(message => Boolean(message.providerOptions));

describe('rolling cache breakpoint', () => {
  it('marks the newest message of the step and keeps the system marker (Anthropic)', () => {
    const out = withRollingCacheBreakpoint(step, 'ANTHROPIC');
    expect(marked(out)).toEqual([true, false, false, true]);
    expect(out.at(-1)?.providerOptions).toEqual(anthropic);
    expect(out[0]).toBe(step[0]);
  });

  it('moves with the conversation: earlier steps lose nothing, only the last gains a marker', () => {
    const first = withRollingCacheBreakpoint(step.slice(0, 2), 'ANTHROPIC');
    expect(marked(first)).toEqual([true, true]);
    // The SDK hands each step the original messages plus responses, so at most two markers are ever live.
    expect(marked(withRollingCacheBreakpoint(step, 'ANTHROPIC')).filter(Boolean)).toHaveLength(2);
  });

  it('uses a cache point on Bedrock', () => {
    const out = withRollingCacheBreakpoint(step.slice(1), 'BEDROCK');
    expect(out.at(-1)?.providerOptions).toEqual({ bedrock: { cachePoint: { type: 'default' } } });
  });

  it('leaves providers that cache on their own untouched', () => {
    expect(withRollingCacheBreakpoint(step, 'OPENAI')).toBe(step);
  });
});

import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { toMessages, toToolSet, withRollingCacheBreakpoint } from '@/lib/intelligence/ai/gateway';
import type { AiGenerateRequest, AiToolDefinition } from '@/lib/intelligence/ai/port';

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

describe('cache markers on the stable prefix', () => {
  const tools: AiToolDefinition[] = ['get_incident', 'list_alerts', 'propose_note'].map(
    (name): AiToolDefinition => ({
      name,
      description: name,
      kind: name.startsWith('propose_') ? 'PROPOSE_WRITE' : 'READ',
      dataClass: 'INTERNAL',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({}),
    })
  );
  const request = {
    context: { actorId: 'a', capability: 'SQUIRE_CHAT', callSite: 'interactive' },
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer', cache: true },
      { role: 'user', content: 'New question' },
    ],
  } as AiGenerateRequest;
  const options = (set: ReturnType<typeof toToolSet>) =>
    Object.values(set ?? {}).map(definition => definition.providerOptions);

  it('marks the system prompt, the end of the history and the last tool (Anthropic)', () => {
    expect(toMessages(request, 'ANTHROPIC').map(message => message.providerOptions)).toEqual([
      anthropic,
      undefined,
      anthropic,
      undefined,
    ]);
    expect(options(toToolSet(tools, 'ANTHROPIC'))).toEqual([undefined, undefined, anthropic]);
  });

  it('uses message cache points on Bedrock, whose tool config has none', () => {
    const bedrock = { bedrock: { cachePoint: { type: 'default' } } };
    expect(toMessages(request, 'BEDROCK').map(message => message.providerOptions)).toEqual([
      bedrock,
      undefined,
      bedrock,
      undefined,
    ]);
    expect(options(toToolSet(tools, 'BEDROCK'))).toEqual([undefined, undefined, undefined]);
  });

  it('adds nothing for providers that cache on their own', () => {
    expect(toMessages(request, 'OPENAI').every(message => !message.providerOptions)).toBe(true);
    expect(options(toToolSet(tools, 'OPENAI'))).toEqual([undefined, undefined, undefined]);
  });
});

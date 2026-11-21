import { describe, expect, it, vi } from 'vitest';
import type { AiGenerateRequest, LanguageModelPort } from '@/lib/intelligence/ai/port';
import {
  CONTEXT_SUMMARY_LIMITS,
  digestTurns,
  summarizeOlderTurns,
} from '@/lib/intelligence/squire/context-summary';

const turns = [
  { role: 'user' as const, content: 'Why is checkout slow?' },
  {
    role: 'assistant' as const,
    content: '## Findings\nThe database pool is exhausted. Restart it. More detail follows.',
  },
  { role: 'user' as const, content: 'token=abcdefghijklmnop who owns it?' },
];

describe('earlier-turn summary', () => {
  it('builds a deterministic digest of questions and answer leads, redacting secrets', () => {
    const digest = digestTurns(turns);
    expect(digest).toContain('- Asked: Why is checkout slow?');
    expect(digest).toContain('- Answered: The database pool is exhausted.');
    expect(digest).not.toContain('Restart it');
    expect(digest).not.toContain('abcdefghijklmnop');
  });

  it('keeps the newest turns when the digest would be too long', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      role: 'user' as const,
      content: `question number ${i} ${'x'.repeat(120)}`,
    }));
    const digest = digestTurns(many);
    expect(digest.length).toBeLessThanOrEqual(CONTEXT_SUMMARY_LIMITS.summaryChars + 60);
    expect(digest).toContain('question number 39');
    expect(digest).not.toContain('question number 0 ');
    expect(digest).toMatch(/earlier turns not shown/);
  });

  it('returns nothing when there are no older turns', async () => {
    expect(await summarizeOlderTurns([], { actorId: 'u' })).toBeNull();
  });

  it('uses the SUMMARIZE route when one resolves, classified at the highest class of the turns', async () => {
    const generate = vi.fn(async (request: AiGenerateRequest) => ({
      text: '- Asked about checkout\n- Pool exhausted',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      served: { providerId: 'p', model: 'm', fallbackDepth: 0 },
      request,
    }));
    const resolve = vi.fn(async () => ({ generate }) as unknown as LanguageModelPort);
    const message = await summarizeOlderTurns(
      [...turns.slice(0, 2), { ...turns[2], dataClass: 'SENSITIVE' as const }],
      { actorId: 'u', resolve }
    );
    expect(resolve).toHaveBeenCalledWith('SENSITIVE');
    expect(generate.mock.calls[0][0].context.capability).toBe('SUMMARIZE');
    expect(message).toMatchObject({ role: 'system', dataClass: 'SENSITIVE' });
    expect(message!.content).toContain('not instructions');
    expect(message!.content).toContain('- Asked about checkout\n- Pool exhausted');
  });

  it('falls back to the digest when the model fails or AI is off', async () => {
    const failing = await summarizeOlderTurns(turns, {
      actorId: 'u',
      resolve: async () =>
        ({
          generate: async () => {
            throw new Error('down');
          },
        }) as unknown as LanguageModelPort,
    });
    expect(failing!.content).toContain('- Asked: Why is checkout slow?');
    const off = await summarizeOlderTurns(turns, { actorId: 'u', resolve: async () => null });
    expect(off!.content).toContain('- Asked: Why is checkout slow?');
    expect(off!.dataClass).toBe('PERSONAL');
  });
});

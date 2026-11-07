import { describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { mintContextProof, readBrowserContext } from '@/lib/intelligence/squire/context-proof';
import { openProposal } from '@/lib/intelligence/squire/actions/proposals';
import { squireRequestSchema } from '@/lib/intelligence/squire/contract';

const actor: AuthorizationActor = { id: 'owner-1', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
const now = new Date('2026-11-03T12:00:00Z');
const text = 'Sensitive previous answer canary';

describe('read-only browser context integrity', () => {
  it('preserves a server-declared Sensitive boundary without granting action authority', async () => {
    const proof = await mintContextProof(
      { actor, role: 'assistant', text, dataClass: 'SENSITIVE' },
      now
    );
    const context = await readBrowserContext(
      actor,
      null,
      [{ role: 'assistant', content: text, contextProof: proof }],
      now
    );
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({ role: 'assistant', dataClass: 'SENSITIVE' });
    expect(context.messages[0].content).toContain(text);
    expect(context.messages[0].content).toContain('verify current facts');
    expect(await openProposal(proof!, actor.id, now)).toBeNull();
  });
  it('omits altered text, roles, ownership and scope instead of downgrading their classification', async () => {
    const proof = await mintContextProof(
      { actor, incidentId: 'incident-a', role: 'assistant', text, dataClass: 'SENSITIVE' },
      now
    );
    for (const [caller, scope, role, content] of [
      [actor, 'incident-a', 'assistant', `${text} changed`],
      [actor, 'incident-a', 'user', text],
      [{ ...actor, id: 'other-owner' }, 'incident-a', 'assistant', text],
      [actor, 'incident-b', 'assistant', text],
      [{ ...actor, role: 'USER' }, 'incident-a', 'assistant', text],
      [{ ...actor, teamIds: ['new-team'] }, 'incident-a', 'assistant', text],
    ] as const) {
      const context = await readBrowserContext(
        caller,
        scope,
        [{ role, content, contextProof: proof }],
        now
      );
      expect(context).toEqual({ messages: [], omitted: true });
    }
  });
  it('does not reuse expired proofs or replay unproved assistant text', async () => {
    const proof = await mintContextProof(
      { actor, role: 'assistant', text, dataClass: 'SENSITIVE' },
      now
    );
    expect(
      await readBrowserContext(
        actor,
        null,
        [{ role: 'assistant', content: text, contextProof: proof }],
        new Date(now.getTime() + 3_600_001)
      )
    ).toEqual({ messages: [], omitted: true });
    expect(
      await readBrowserContext(actor, null, [{ role: 'assistant', content: text }], now)
    ).toEqual({ messages: [], omitted: true });
    expect(
      (await readBrowserContext(actor, null, [{ role: 'user', content: 'My own question' }], now))
        .messages
    ).toMatchObject([{ role: 'user', dataClass: 'PERSONAL' }]);
  });
  it('accepts integrity proofs but never a browser-declared lower data class', () => {
    expect(
      squireRequestSchema.safeParse({
        message: 'hi',
        history: [{ role: 'assistant', content: text, contextProof: 'opaque' }],
      }).success
    ).toBe(true);
    expect(
      squireRequestSchema.safeParse({
        message: 'hi',
        history: [{ role: 'assistant', content: text, dataClass: 'PUBLIC' }],
      }).success
    ).toBe(false);
  });
});

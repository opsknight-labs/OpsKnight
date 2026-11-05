import 'server-only';
import { sha256 } from '../ai/digest';
import { z } from 'zod/v4';
import { decrypt, encrypt } from '@/lib/encryption';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AI_DATA_CLASSES, highestDataClass, type AiDataClass, type AiMessage } from '../ai/port';
import type { SourceReference } from '../conversations/contract';
import { readSourceStates, sourceKey, type SourceIdentity } from './evidence-access';

const MAX_TEXT = 4_000;
const MAX_PROOF = 8_192;
const TTL_MS = 60 * 60_000;
const proofSchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('squire-context'),
    actorId: z.string().min(1).max(64),
    authorizationHash: z.string().regex(/^[a-f0-9]{64}$/),
    incidentId: z.string().max(64).nullable(),
    role: z.enum(['user', 'assistant']),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    dataClass: z.enum(AI_DATA_CLASSES),
    exp: z.number().finite(),
    observedAt: z.string().datetime(),
    sources: z
      .array(
        z
          .object({
            kind: z.enum([
              'incident',
              'runbook',
              'change',
              'alert',
              'service',
              'schedule',
              'person',
              'status_page',
              'postmortem',
            ]),
            id: z.string().min(1).max(64),
            sourceUpdatedAt: z.string().datetime().optional(),
          })
          .strict()
      )
      .max(16),
  })
  .strict();
export const authorizationContextHash = (actor: AuthorizationActor): string =>
  sha256(
    JSON.stringify({
      role: actor.role,
      status: actor.status,
      teams: [...actor.teamIds].sort(),
    })
  );

const textHash = (text: string) => sha256(text.slice(0, MAX_TEXT));

/** Read-only context integrity, never a write proposal or an authorization grant. Not persisted. */
export async function mintContextProof(
  input: {
    actor: AuthorizationActor;
    incidentId?: string | null;
    role: 'user' | 'assistant';
    text: string;
    dataClass: AiDataClass;
    sources?: readonly SourceReference[];
    observedAt?: Date;
  },
  now: Date = new Date()
): Promise<string | undefined> {
  if (input.actor.status !== 'ACTIVE' || input.actor.apiKey || (input.sources?.length ?? 0) > 16)
    return undefined;
  const data = proofSchema.parse({
    v: 1,
    kind: 'squire-context',
    actorId: input.actor.id,
    authorizationHash: authorizationContextHash(input.actor),
    incidentId: input.incidentId ?? null,
    role: input.role,
    hash: textHash(input.text),
    dataClass: input.dataClass,
    exp: now.getTime() + TTL_MS,
    observedAt: (input.observedAt ?? now).toISOString(),
    sources: (input.sources ?? []).map(source => ({
      kind: source.kind,
      id: source.id,
      ...(source.sourceUpdatedAt ? { sourceUpdatedAt: source.sourceUpdatedAt } : {}),
    })),
  });
  const proof = await encrypt(JSON.stringify(data));
  return proof.length <= MAX_PROOF ? proof : undefined;
}

/** Unproved assistant text is omitted, not silently relabelled Personal. User-authored text remains input. */
export async function readBrowserContext(
  actor: AuthorizationActor,
  incidentId: string | null,
  history: readonly { role: 'user' | 'assistant'; content: string; contextProof?: string }[],
  now: Date = new Date()
): Promise<{ messages: AiMessage[]; omitted: boolean }> {
  if (actor.status !== 'ACTIVE' || actor.apiKey)
    return { messages: [], omitted: history.length > 0 };
  const decoded = await Promise.all(
    history.map(async turn => {
      if (!turn.contextProof)
        return turn.role === 'user'
          ? { turn, dataClass: 'PERSONAL' as const, sources: [] as SourceIdentity[] }
          : null;
      if (turn.contextProof.length > MAX_PROOF) return null;
      try {
        const parsed = proofSchema.safeParse(JSON.parse(await decrypt(turn.contextProof)));
        if (!parsed.success) return null;
        const value = parsed.data;
        if (
          value.exp <= now.getTime() ||
          value.actorId !== actor.id ||
          value.authorizationHash !== authorizationContextHash(actor) ||
          value.incidentId !== incidentId ||
          value.role !== turn.role ||
          value.hash !== textHash(turn.content)
        )
          return null;
        return {
          turn,
          dataClass: value.dataClass,
          sources: value.sources,
          observedAt: value.observedAt,
        };
      } catch {
        return null;
      }
    })
  );
  const states = await readSourceStates(
    actor,
    decoded.flatMap(value => value?.sources ?? [])
  );
  const messages: AiMessage[] = [];
  for (const value of decoded) {
    if (!value || value.sources.some(source => !states.has(sourceKey(source)))) continue;
    if (
      value.sources.some(
        source =>
          'sourceUpdatedAt' in source &&
          source.sourceUpdatedAt &&
          states.get(sourceKey(source))?.updatedAt !== source.sourceUpdatedAt
      )
    )
      continue;
    messages.push({
      role: value.turn.role,
      content:
        value.turn.role === 'assistant' && 'observedAt' in value
          ? `[Earlier answer recorded ${value.observedAt}; verify current facts with tools.]\n${value.turn.content.slice(0, MAX_TEXT)}`
          : value.turn.content.slice(0, MAX_TEXT),
      dataClass: highestDataClass(['PERSONAL', value.dataClass]),
    });
  }
  return { messages, omitted: messages.length !== history.length };
}

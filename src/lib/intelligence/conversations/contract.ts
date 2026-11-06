import { z } from 'zod/v4';
import { AI_DATA_CLASSES } from '../ai/port';

export const conversationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GLOBAL') }).strict(),
  z.object({ kind: z.literal('INCIDENT'), incidentId: z.string().min(1).max(64) }).strict(),
]);
export type ConversationScope = z.infer<typeof conversationScopeSchema>;

export const sourceReferenceSchema = z
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
    handle: z.string().uuid(),
    observedAt: z.string().datetime(),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    sourceUpdatedAt: z.string().datetime().optional(),
    dataClass: z.enum(AI_DATA_CLASSES),
  })
  .strict();
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

export const savedCitationSchema = z
  .object({
    kind: z.enum(['incident', 'runbook', 'change', 'alert', 'service', 'schedule', 'postmortem']),
    id: z.string().min(1).max(64),
    label: z.string().max(200),
    href: z.string().max(256),
    handle: z.string().uuid().optional(),
    observedAt: z.string().datetime().optional(),
    version: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    why: z.string().max(200).optional(),
  })
  .strict()
  .refine(citation => {
    const prefix =
      citation.kind === 'incident'
        ? '/incidents/'
        : citation.kind === 'runbook'
          ? '/runbooks/'
          : citation.kind === 'change'
            ? '/changes/'
            : citation.kind === 'service'
              ? '/services/'
              : citation.kind === 'schedule'
                ? '/schedules/'
                : citation.kind === 'postmortem'
                  ? '/postmortems/'
                  : '/alerts/';
    return citation.href === `${prefix}${encodeURIComponent(citation.id)}`;
  }, 'A saved citation must use its canonical internal destination');

/** An outcome reference can only be read. Sealed confirmation tokens are never accepted here. */
export const savedActionReferenceSchema = z
  .object({
    receiptId: z.string().uuid(),
    action: z.string().regex(/^[a-z_]{1,64}$/),
    title: z.string().max(120),
    incidentId: z.string().min(1).max(64),
  })
  .strict();
export type SavedActionReference = z.infer<typeof savedActionReferenceSchema>;

export const savedTurnInputSchema = z
  .object({
    mode: z.enum(['ai', 'basic', 'unknown']).default('unknown'),
    completion: z.enum(['COMPLETED', 'INTERRUPTED', 'STOPPED', 'FAILED']).default('COMPLETED'),
    dataClass: z.enum(AI_DATA_CLASSES).default('PERSONAL'),
    citations: z.array(savedCitationSchema).max(8).default([]),
    sources: z.array(sourceReferenceSchema).max(32).default([]),
    notices: z.array(z.string().max(1_000)).max(4).default([]),
    actions: z.array(savedActionReferenceSchema).max(2).default([]),
    verified: z.boolean().default(false),
    authorizationHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type SavedTurnInput = z.input<typeof savedTurnInputSchema>;
export type SavedTurn = z.output<typeof savedTurnInputSchema>;

// Text stays in its existing encrypted column for reader compatibility. The encrypted metadata is
// bound to that exact text by its digest; together they form one versioned turn envelope.
export const storedTurnEnvelopeSchema = savedTurnInputSchema
  .extend({
    v: z.literal(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type StoredTurnEnvelope = z.infer<typeof storedTurnEnvelopeSchema>;

export const scopeForIncident = (incidentId: string | null | undefined): ConversationScope =>
  incidentId ? { kind: 'INCIDENT', incidentId } : { kind: 'GLOBAL' };

export const conversationCursorSchema = z
  .object({
    updatedAt: z.string().datetime(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  })
  .strict();
export type ConversationCursor = z.infer<typeof conversationCursorSchema>;

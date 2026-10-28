import { z } from 'zod/v4';

export const SQUIRE_LIMITS = {
  messageMax: 2_000,
  historyMax: 10,
  /** Ceiling on tool round trips per answer. */
  maxSteps: 4,
} as const;

export const squireRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(SQUIRE_LIMITS.messageMax),
    // Only user/assistant turns are accepted from the browser. A client can never inject a system turn.
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(SQUIRE_LIMITS.messageMax) }).strict())
      .max(SQUIRE_LIMITS.historyMax)
      .default([]),
    incidentId: z.string().trim().min(1).max(64).optional(),
    /** Saved conversation to continue; ignored unless history is on and the caller owns it. */
    conversationId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();
export type SquireRequest = z.infer<typeof squireRequestSchema>;

export type SquireEvent =
  | { type: 'meta'; mode: 'ai' | 'basic'; name: string }
  | { type: 'delta'; text: string }
  | { type: 'notice'; text: string }
  | { type: 'done' }
  /** Sent after `done` when the exchange was saved, so the next question continues the same conversation. */
  | { type: 'conversation'; id: string }
  | { type: 'error'; message: string };

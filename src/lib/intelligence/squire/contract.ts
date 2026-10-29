import { z } from 'zod/v4';
import type { SquireProposal } from './actions/catalog';

export const SQUIRE_LIMITS = {
  messageMax: 2_000,
  /** Earlier turns are context only; long answers are trimmed to this rather than rejected. */
  historyTurnMax: 4_000,
  historyMax: 10,
  /** Ceiling on model/tool round trips per answer. */
  maxSteps: 6,
} as const;

/** Anything up to this is accepted and trimmed; beyond it the request is malformed, not just long. */
const HISTORY_TURN_ACCEPTED = 16_000;

export const squireRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(SQUIRE_LIMITS.messageMax),
    // Only user/assistant turns are accepted from the browser. A client can never inject a system turn.
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z
              .string()
              .max(HISTORY_TURN_ACCEPTED)
              .transform(content => content.slice(0, SQUIRE_LIMITS.historyTurnMax)),
          })
          .strict()
      )
      .max(SQUIRE_LIMITS.historyMax * 2)
      .default([])
      .transform(turns => turns.slice(-SQUIRE_LIMITS.historyMax)),
    incidentId: z.string().trim().min(1).max(64).optional(),
    /** Saved conversation to continue; ignored unless history is on and the caller owns it. */
    conversationId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export type SquireRequest = z.infer<typeof squireRequestSchema>;

/** A link the answer relied on, checked to be readable by the person before it is shown. */
export interface SquireCitation {
  kind: 'incident' | 'runbook';
  id: string;
  label: string;
  href: string;
}

export type SquireEvent =
  | { type: 'meta'; mode: 'ai' | 'basic'; name: string }
  | { type: 'delta'; text: string }
  /** The assistant is looking something up; `label` is a short present-tense description. */
  | { type: 'tool'; label: string }
  /** An action the person may confirm. Nothing has happened yet. */
  | { type: 'proposal'; proposal: SquireProposal & { href?: string } }
  | { type: 'citations'; items: SquireCitation[] }
  | { type: 'suggestions'; items: string[] }
  | { type: 'notice'; text: string }
  | { type: 'done' }
  /** Sent after `done` when the exchange was saved, so the next question continues the same conversation. */
  | { type: 'conversation'; id: string }
  | { type: 'error'; message: string };

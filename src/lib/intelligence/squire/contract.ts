import { z } from 'zod/v4';
import type { SavedTurnInput } from '../conversations/contract';
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
            contextProof: z.string().min(1).max(8_192).optional(),
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
    /**
     * The page the person is on, so "this service" or "who is on call for this team" resolve. Only an
     * identifier: the server reads the entity under the person's own permissions or ignores it.
     */
    pageContext: z
      .object({
        kind: z.enum(['service', 'team', 'schedule', 'runbook', 'alert', 'change']),
        id: z.string().trim().min(1).max(64),
      })
      .strict()
      .optional(),
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
  kind: 'incident' | 'runbook' | 'change' | 'alert' | 'service' | 'schedule' | 'postmortem';
  id: string;
  label: string;
  href: string;
  handle?: string;
  observedAt?: string;
  version?: string;
  why?: string;
}

export type SquireEvent =
  | {
      type: 'meta';
      mode: 'ai' | 'basic';
      name: string;
      availability?: 'ready' | 'disabled' | 'quota' | 'unavailable';
      attention?: boolean;
      /** The deterministic intent the basic answer was built for; used for feedback and tests. */
      intent?: string;
    }
  | { type: 'delta'; text: string }
  /** The assistant is looking something up; `label` is a short present-tense description. */
  | { type: 'tool'; label: string }
  /**
   * An action the person may confirm. Nothing has happened yet. `untrustedContext` is set when the turn read
   * alerts, notes or other third-party text before proposing, so the person checks that content first.
   */
  | { type: 'proposal'; proposal: SquireProposal & { href?: string; untrustedContext?: boolean } }
  | { type: 'citations'; items: SquireCitation[] }
  | { type: 'suggestions'; items: string[] }
  | { type: 'notice'; text: string }
  /** Trusted internal persistence metadata; the HTTP stream never forwards this event to the browser. */
  | { type: 'memory'; turn: SavedTurnInput }
  /** Read-only integrity proofs for browser-held turns; these never authorize an action. */
  | { type: 'context'; userProof?: string; assistantProof?: string }
  | { type: 'done' }
  /** Sent after `done` when the exchange was saved, so the next question continues the same conversation. */
  | { type: 'conversation'; id: string }
  | { type: 'error'; message: string; availability?: 'quota' | 'unavailable' }
  /**
   * One step of an investigation (AI mode only, when an administrator enabled it). Sent when a step starts
   * and again when it finishes, with the same `index`; the client replaces the step it already shows.
   */
  | { type: 'investigation'; step: SquireInvestigationStep };

/** A visible investigation step: what the assistant decided to check and which reads it ran. */
export interface SquireInvestigationStep {
  index: number;
  title: string;
  status: 'running' | 'done' | 'failed';
  calls: Array<{ tool: string; label: string; ok?: boolean }>;
}

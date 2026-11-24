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
  /** Records picked with "@" in one question. */
  mentionsMax: 5,
} as const;

export const SQUIRE_MENTION_KINDS = [
  'incident',
  'service',
  'schedule',
  'team',
  'runbook',
  'person',
] as const;
export type SquireMentionKind = (typeof SQUIRE_MENTION_KINDS)[number];

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
        kind: z.enum([
          'service',
          'team',
          'schedule',
          'runbook',
          'alert',
          'change',
          'postmortem',
          'escalation_policy',
          'status_page',
        ]),
        id: z.string().trim().min(1).max(64),
      })
      .strict()
      .optional(),
    /**
     * Records the person picked with "@". Only identifiers: each is read under the person's own
     * permissions, and one they cannot read is ignored without saying so.
     */
    mentions: z
      .array(
        z
          .object({
            kind: z.enum(SQUIRE_MENTION_KINDS),
            id: z.string().trim().min(1).max(64),
          })
          .strict()
      )
      .max(SQUIRE_LIMITS.mentionsMax)
      .optional(),
    /** Saved conversation to continue; ignored unless history is on and the caller owns it. */
    conversationId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    /** A retry of the latest answer: replaces that exchange in the saved conversation instead of appending. */
    replaceLastExchange: z.boolean().optional(),
  })
  .strict();
export type SquireRequest = z.infer<typeof squireRequestSchema>;

export const SQUIRE_CHART_LIMITS = {
  /** Charts one answer may carry. */
  perTurn: 2,
  series: 4,
  points: 200,
  title: 120,
  name: 80,
  unit: 16,
} as const;

/**
 * A line chart drawn under an answer. Built on the server from what a read tool returned (never from model
 * text), bounded, and saved with the turn so a reopened conversation shows it again.
 */
export const squireChartSchema = z
  .object({
    title: z.string().trim().min(1).max(SQUIRE_CHART_LIMITS.title),
    unit: z.string().trim().min(1).max(SQUIRE_CHART_LIMITS.unit).optional(),
    series: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(SQUIRE_CHART_LIMITS.name),
            points: z
              .array(z.object({ t: z.iso.datetime(), v: z.number().finite() }).strict())
              .min(1)
              .max(SQUIRE_CHART_LIMITS.points),
          })
          .strict()
      )
      .min(1)
      .max(SQUIRE_CHART_LIMITS.series),
    /** Where the numbers came from; `href` only for an in-app page. */
    source: z
      .object({
        kind: z.enum(['observability', 'incident', 'service']),
        id: z.string().min(1).max(64),
        label: z.string().max(SQUIRE_CHART_LIMITS.title).optional(),
        href: z
          .string()
          .max(256)
          .regex(/^\/(?!\/)/)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SquireChart = z.infer<typeof squireChartSchema>;

const traceText = z.string().max(200);
const tokenCount = z.number().int().nonnegative();

/**
 * How an answer was made ("How I got this"): sent as the turn's last event before `done` and saved with the
 * turn. Labels only: tool names, prompts and raw results never leave the server.
 */
export const squireTraceSchema = z
  .object({
    mode: z.enum(['ai', 'basic']),
    /** What the assistant looked up, as the progress labels the person saw. */
    tools: z.array(traceText).max(24),
    /** The cited sources' labels. */
    sources: z.array(traceText).max(8),
    model: traceText.optional(),
    provider: traceText.optional(),
    tokens: z
      .object({ input: tokenCount, output: tokenCount, cacheRead: tokenCount.optional() })
      .strict()
      .optional(),
    durationMs: tokenCount,
    /** Every record the answer read was captured as evidence. */
    verified: z.boolean(),
  })
  .strict();
export type SquireTrace = z.infer<typeof squireTraceSchema>;

/** Provider kinds as people know them, for the trace. */
export const AI_PROVIDER_LABELS: Record<string, string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  GOOGLE: 'Google Gemini',
  AZURE_OPENAI: 'Azure OpenAI',
  BEDROCK: 'Amazon Bedrock',
  VERTEX: 'Google Vertex AI',
  MISTRAL: 'Mistral',
  GROQ: 'Groq',
  OPENAI_COMPATIBLE: 'OpenAI-compatible',
};

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
      /** With `availability: 'unavailable'`: a setting, not a passing failure, kept AI out (no retry helps). */
      reason?: string;
      /** With `availability: 'quota'`: whether a short-term request rate or the daily budget was hit. */
      limit?: SquireAiLimit;
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
  /** A chart of time series a read tool returned this turn (see `squireChartSchema`). */
  | { type: 'chart'; chart: SquireChart }
  | { type: 'suggestions'; items: string[] }
  | { type: 'notice'; text: string }
  /** How the answer was made; sent just before `done` (see `squireTraceSchema`). */
  | { type: 'trace'; trace: SquireTrace }
  /** Trusted internal persistence metadata; the HTTP stream never forwards this event to the browser. */
  | { type: 'memory'; turn: SavedTurnInput }
  /** Read-only integrity proofs for browser-held turns; these never authorize an action. */
  | { type: 'context'; userProof?: string; assistantProof?: string }
  | { type: 'done' }
  /** Sent after `done` when the exchange was saved, so the next question continues the same conversation. */
  | { type: 'conversation'; id: string }
  | {
      type: 'error';
      message: string;
      availability?: 'quota' | 'unavailable';
      limit?: SquireAiLimit;
    }
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

/**
 * Which AI limit stopped a turn. A rate limit clears within minutes and is worth retrying; an exhausted
 * daily budget needs an administrator. Older browsers ignore the field and keep showing the shared
 * `quota` availability, so adding it is backward compatible.
 */
export type SquireAiLimit = 'rate' | 'budget';

/** Reads the limit from the AI gateway's error text ("Too many requests", "Daily AI budget reached"). */
export function aiLimitFrom(message: string): SquireAiLimit | undefined {
  if (/too many/i.test(message)) return 'rate';
  if (/budget|quota/i.test(message)) return 'budget';
  return undefined;
}

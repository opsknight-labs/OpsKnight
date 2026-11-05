import { z } from 'zod/v4';

const line = (max: number) => z.string().trim().min(1).max(max);
const lines = (count: number, max: number) => z.array(line(max)).max(count);

/** What a summary may contain. Every field is bounded, so a misbehaving model cannot flood the page. */
export const incidentSummarySchema = z
  .object({
    headline: line(200),
    currentState: line(600),
    impact: z.string().trim().max(600),
    keyEvents: lines(8, 240),
    possibleCauses: lines(5, 240),
    nextSteps: lines(5, 240),
  })
  .strict();
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;

export const postmortemDraftSchema = z
  .object({
    summary: line(2_000),
    impact: z.string().trim().max(1_200),
    rootCause: z.string().trim().max(2_000),
    resolution: z.string().trim().max(2_000),
    lessons: z.string().trim().max(2_000),
    actionItems: z
      .array(
        z
          .object({
            title: line(200),
            description: z.string().trim().max(600),
            priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
          })
          .strict()
      )
      .max(10),
  })
  .strict();
export type PostmortemDraft = z.infer<typeof postmortemDraftSchema>;

export type DraftFailure =
  | 'AI_OFF'
  | 'NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'NO_PROVIDER_FOR_DATA'
  | 'LIMITED'
  | 'INVALID_OUTPUT'
  | 'UNAVAILABLE';

export const DRAFT_FAILURE_MESSAGES: Record<DraftFailure, string> = {
  AI_OFF: 'AI is turned off. An administrator can enable it in Settings, Intelligence, Assistant & AI.',
  NOT_ALLOWED: 'You do not have permission to do this.',
  NOT_FOUND: 'Incident not found.',
  NO_PROVIDER_FOR_DATA:
    'No AI provider is allowed to receive incident notes and timelines. An administrator can raise a provider’s data limit to Personal.',
  LIMITED: 'AI usage limits have been reached. Try again later.',
  INVALID_OUTPUT: 'The AI response was not in the expected format, so nothing was used. Try again.',
  UNAVAILABLE: 'AI is unavailable right now. Try again later.',
};

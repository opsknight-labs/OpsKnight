/**
 * Feedback contract. Client-safe (no Prisma, no server-only): shared by the domain service, server
 * actions, REST v2 and the UI controls.
 */
import { z } from 'zod/v4';

export const FEEDBACK_SUBJECT_TYPES = ['FINDING', 'CORRELATION_MEMBER', 'INCIDENT_RELATIONSHIP'] as const;
export type FeedbackSubjectType = (typeof FEEDBACK_SUBJECT_TYPES)[number];

export const FEEDBACK_VERDICTS = ['HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT'] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

/** Suggestions are judged on usefulness; groupings and links are judged on correctness. */
export function verdictAllowedFor(subject: FeedbackSubjectType, verdict: FeedbackVerdict): boolean {
  switch (subject) {
    case 'FINDING':
      return verdict === 'HELPFUL' || verdict === 'NOT_HELPFUL';
    case 'CORRELATION_MEMBER':
    case 'INCIDENT_RELATIONSHIP':
      return verdict === 'CORRECT' || verdict === 'INCORRECT';
  }
}

export const FEEDBACK_REASON_CODES = [
  'WRONG_SERVICE',
  'UNRELATED',
  'OUTDATED',
  'ALREADY_KNOWN',
  'DUPLICATE',
  'TOO_BROAD',
  'OTHER',
] as const;
export type FeedbackReasonCode = (typeof FEEDBACK_REASON_CODES)[number];

export const FEEDBACK_NOTE_MAX_LENGTH = 500;
/** Per actor, per hour. Generous for genuine use, small enough to blunt automated poisoning. */
export const FEEDBACK_RATE_LIMIT = { limit: 60, windowMs: 3_600_000 } as const;

export const submitFeedbackSchema = z
  .object({
    subjectType: z.enum(FEEDBACK_SUBJECT_TYPES),
    subjectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid subject id'),
    verdict: z.enum(FEEDBACK_VERDICTS),
    reasonCode: z.enum(FEEDBACK_REASON_CODES).optional(),
    note: z
      .string()
      .transform(value =>
        value
          .replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .replace(/ {2,}/g, ' ')
          .trim()
      )
      .pipe(z.string().max(FEEDBACK_NOTE_MAX_LENGTH))
      .optional(),
  })
  .strict()
  .refine(value => verdictAllowedFor(value.subjectType, value.verdict), {
    message: 'This verdict does not apply to that kind of subject',
    path: ['verdict'],
  })
  .refine(value => value.verdict === 'NOT_HELPFUL' || value.verdict === 'INCORRECT' || !value.reasonCode, {
    message: 'A reason applies only to negative feedback',
    path: ['reasonCode'],
  });
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const revokeFeedbackSchema = z
  .object({
    subjectType: z.enum(FEEDBACK_SUBJECT_TYPES),
    subjectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid subject id'),
  })
  .strict();
export type RevokeFeedbackInput = z.infer<typeof revokeFeedbackSchema>;

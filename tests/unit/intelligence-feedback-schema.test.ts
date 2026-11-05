// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_NOTE_MAX_LENGTH,
  revokeFeedbackSchema,
  submitFeedbackSchema,
  verdictAllowedFor,
} from '@/lib/intelligence/feedback/schema';

const base = { subjectType: 'FINDING', subjectId: 'abc123', verdict: 'HELPFUL' } as const;

describe('feedback schema', () => {
  it('accepts a plain positive verdict', () => {
    expect(submitFeedbackSchema.safeParse(base).success).toBe(true);
  });

  it('matches verdicts to subject types', () => {
    expect(verdictAllowedFor('FINDING', 'HELPFUL')).toBe(true);
    expect(verdictAllowedFor('FINDING', 'CORRECT')).toBe(false);
    expect(verdictAllowedFor('CORRELATION_MEMBER', 'INCORRECT')).toBe(true);
    expect(verdictAllowedFor('INCIDENT_RELATIONSHIP', 'HELPFUL')).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, verdict: 'CORRECT' }).success).toBe(false);
  });

  it('allows a reason only on negative feedback', () => {
    expect(submitFeedbackSchema.safeParse({ ...base, reasonCode: 'UNRELATED' }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, verdict: 'NOT_HELPFUL', reasonCode: 'UNRELATED' }).success).toBe(true);
    expect(submitFeedbackSchema.safeParse({ ...base, verdict: 'NOT_HELPFUL', reasonCode: 'MADE_UP' }).success).toBe(false);
  });

  it('strips control characters and bounds the note', () => {
    const parsed = submitFeedbackSchema.parse({ ...base, verdict: 'NOT_HELPFUL', note: '  bad\u0000\u0007 match\n\n here ' });
    expect(parsed.note).toBe('bad match here');
    expect(
      submitFeedbackSchema.safeParse({ ...base, verdict: 'NOT_HELPFUL', note: 'x'.repeat(FEEDBACK_NOTE_MAX_LENGTH + 1) }).success
    ).toBe(false);
  });

  it('rejects malformed ids and unknown keys', () => {
    expect(submitFeedbackSchema.safeParse({ ...base, subjectId: "x'; DROP TABLE" }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, subjectId: '' }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ ...base, actorId: 'someone-else' }).success).toBe(false);
  });

  it('validates revocation input', () => {
    expect(revokeFeedbackSchema.safeParse({ subjectType: 'FINDING', subjectId: 'a1' }).success).toBe(true);
    expect(revokeFeedbackSchema.safeParse({ subjectType: 'NOPE', subjectId: 'a1' }).success).toBe(false);
  });
});

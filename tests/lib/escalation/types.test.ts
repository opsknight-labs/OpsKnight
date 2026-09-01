import { describe, expect, it } from 'vitest';
import { escalationOutcomeForError } from '@/lib/escalation/types';

describe('escalationOutcomeForError', () => {
  it.each(['P2034', 'P2028', 'P2002', 'P1001', 'P1002', 'P1008', 'P1017'])(
    'treats Prisma %s as retryable without relying on instanceof',
    code => {
      expect(escalationOutcomeForError({ code, message: 'database operation failed' })).toBe(
        'RETRYABLE_FAILURE'
      );
    }
  );

  it('honors the domain retryable marker through wrapped infrastructure errors', () => {
    expect(escalationOutcomeForError({ retryable: true, message: 'target lookup failed' })).toBe(
      'RETRYABLE_FAILURE'
    );
  });

  it('does not retry deterministic engine failures', () => {
    expect(escalationOutcomeForError(new Error('unsupported target configuration'))).toBe(
      'TERMINAL_FAILURE'
    );
  });
});

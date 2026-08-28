import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { scheduleActionError, scheduleValidationError } from '@/lib/schedule-action-errors';

describe('schedule action error adapter', () => {
  it('preserves the visible domain error while adding machine-readable metadata', () => {
    const state = scheduleActionError(
      new AppError({
        code: 'SCHEDULE_LAYER_USER_DUPLICATE',
        userMessage: 'Taylor is already assigned to "Primary".',
      }),
      'fallback'
    );

    expect(state).toMatchObject({
      error: 'Taylor is already assigned to "Primary".',
      code: 'SCHEDULE_LAYER_USER_DUPLICATE',
      retryable: false,
    });
  });

  it('serializes structured validation fields without changing the visible message', () => {
    const state = scheduleValidationError('Schedule name is required.', [
      { field: 'name', code: 'required', message: 'Schedule name is required.' },
    ]);

    expect(state.error).toBe('Schedule name is required.');
    expect(state.code).toBe('VALIDATION_FAILED');
    expect(state.fields).toEqual([
      { field: 'name', code: 'required', message: 'Schedule name is required.' },
    ]);
  });

  it('does not expose unexpected database or infrastructure errors to the client', () => {
    expect(
      scheduleActionError(
        new Error('Prisma P2002: Unique constraint failed on internal_table_secret'),
        'Failed to update schedule.'
      )
    ).toEqual({ error: 'Failed to update schedule.' });

    expect(scheduleActionError('unknown', 'Failed to update schedule.')).toEqual({
      error: 'Failed to update schedule.',
    });
  });

  it('exposes the new schedule conflict codes through the centralized error registry', () => {
    expect(
      scheduleActionError(new AppError({ code: 'SCHEDULE_RESPONDER_NOT_ACTIVE' }), 'fallback')
    ).toMatchObject({
      code: 'SCHEDULE_RESPONDER_NOT_ACTIVE',
      retryable: false,
    });
    expect(
      scheduleActionError(new AppError({ code: 'SCHEDULE_OVERRIDE_CONFLICT' }), 'fallback')
    ).toMatchObject({
      code: 'SCHEDULE_OVERRIDE_CONFLICT',
      retryable: false,
    });
  });
});

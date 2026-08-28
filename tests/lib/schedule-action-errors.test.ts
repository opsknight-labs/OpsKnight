import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { scheduleActionError, scheduleValidationError } from '@/lib/schedule-action-errors';

describe('schedule action error adapter', () => {
  it('preserves the legacy error string while adding machine-readable metadata', () => {
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

  it('keeps legacy non-AppError behavior for compatibility', () => {
    expect(scheduleActionError(new Error('Legacy schedule failure.'), 'fallback')).toEqual({
      error: 'Legacy schedule failure.',
    });
    expect(scheduleActionError('unknown', 'fallback')).toEqual({ error: 'fallback' });
  });
});

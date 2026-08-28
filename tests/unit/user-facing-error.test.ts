import { describe, expect, it } from 'vitest';
import { toUserFacingError } from '@/lib/user-facing-error';

describe('toUserFacingError', () => {
  it('preserves clear product guidance', () => {
    expect(
      toUserFacingError('Alex is already assigned to Primary. Remove them there before continuing.')
    ).toEqual({
      title: 'Alex is already assigned to Primary. Remove them there before continuing.',
    });
  });

  it('hides database implementation details', () => {
    expect(toUserFacingError('Prisma P2002: Unique constraint failed')).toEqual({
      title: 'That item already exists',
      description: 'Choose a different value or update the existing item instead.',
    });
  });

  it('turns network failures into recovery guidance', () => {
    expect(toUserFacingError(new Error('Failed to fetch'))).toEqual({
      title: 'Connection problem',
      description: 'Check your connection and try again. Your changes may not have been saved.',
    });
  });

  it('explains legacy authorization failures without exposing server text', () => {
    expect(toUserFacingError('Unauthorized. Admin access required.')).toEqual({
      title: 'You do not have permission to do that',
      description: 'Ask an administrator for access, or sign in with an account that has permission.',
    });
  });

  it('uses the stable code instead of inferring semantics from a misleading message', () => {
    expect(
      toUserFacingError({
        error: 'Everything is fine',
        code: 'AUTHORIZATION_DENIED',
        action: 'Ask your team administrator for access.',
        retryable: false,
      })
    ).toEqual({
      title: 'You do not have permission to do that',
      description: 'Ask your team administrator for access.',
      code: 'AUTHORIZATION_DENIED',
      action: 'Ask your team administrator for access.',
      retryable: false,
      fields: undefined,
    });
  });

  it('preserves field metadata and conflict recovery guidance', () => {
    expect(
      toUserFacingError({
        error: 'Schedule name is already in use.',
        code: 'SCHEDULE_NAME_CONFLICT',
        retryable: false,
        fields: [{ field: 'name', code: 'duplicate', message: 'Choose another name.' }],
      })
    ).toEqual({
      title: 'Schedule name is already in use.',
      description: 'Choose a different schedule name.',
      code: 'SCHEDULE_NAME_CONFLICT',
      action: 'Choose a different schedule name.',
      retryable: false,
      fields: [{ field: 'name', code: 'duplicate', message: 'Choose another name.' }],
    });
  });

  it('uses retry metadata for rate-limit errors', () => {
    expect(
      toUserFacingError({
        error: 'Do not trust this text for classification.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true,
      })
    ).toEqual({
      title: 'Too many requests',
      description: 'Wait briefly before trying again.',
      code: 'RATE_LIMIT_EXCEEDED',
      action: 'Wait briefly before trying again.',
      retryable: true,
      fields: undefined,
    });
  });
});

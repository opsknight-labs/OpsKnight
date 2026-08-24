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

  it('explains authorization failures without exposing server text', () => {
    expect(toUserFacingError('Unauthorized. Admin access required.')).toEqual({
      title: 'You do not have permission to do that',
      description: 'Ask an administrator for access, or sign in with an account that has permission.',
    });
  });
});

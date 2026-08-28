import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { getUserFriendlyError, getSuccessMessage } from '@/lib/user-friendly-errors';

describe('User-Friendly Error compatibility shim', () => {
  describe('getUserFriendlyError', () => {
    it('does not translate authorization wording by substring', () => {
      const error = 'Unauthorized. Admin access required.';
      expect(getUserFriendlyError(error)).toBe(error);
    });

    it('does not translate network wording by substring', () => {
      const error = 'Failed to fetch';
      expect(getUserFriendlyError(error)).toBe(error);
    });

    it('redacts technical legacy strings instead of interpreting them', () => {
      expect(getUserFriendlyError('Prisma P2002: Unique constraint failed')).toBe(
        "We couldn't complete that action"
      );
    });

    it('does not expose arbitrary Error messages', () => {
      expect(getUserFriendlyError(new Error('Unauthorized secret backend detail'))).toBe(
        "We couldn't complete that action"
      );
    });

    it('uses typed AppError semantics when available', () => {
      expect(getUserFriendlyError(new AppError({ code: 'AUTHORIZATION_DENIED' }))).toBe(
        'You do not have permission to do that'
      );
    });

    it('handles unknown error types safely', () => {
      expect(getUserFriendlyError({ message: 'Some error' })).toBe("We couldn't complete that action");
    });
  });

  describe('getSuccessMessage', () => {
    it('should return success message for create action', () => {
      expect(getSuccessMessage('create', 'Incident')).toBe('Incident created successfully.');
    });

    it('should return success message for update action', () => {
      expect(getSuccessMessage('update', 'User')).toBe('User updated successfully.');
    });

    it('should return success message for delete action', () => {
      expect(getSuccessMessage('delete', 'Service')).toBe('Service deleted successfully.');
    });

    it('should return success message for invite action', () => {
      expect(getSuccessMessage('invite', 'User')).toBe('Invitation sent to user successfully.');
    });

    it('should return success message for assign action', () => {
      expect(getSuccessMessage('assign', 'Incident')).toBe('Assigned successfully.');
    });

    it('should return success message for resolve action', () => {
      expect(getSuccessMessage('resolve', 'Incident')).toBe('Incident resolved successfully.');
    });

    it('should return success message for acknowledge action', () => {
      expect(getSuccessMessage('acknowledge', 'Incident')).toBe('Incident acknowledged successfully.');
    });

    it('should return generic message for unknown action', () => {
      expect(getSuccessMessage('unknown', 'Item')).toBe('unknown completed successfully.');
    });
  });
});

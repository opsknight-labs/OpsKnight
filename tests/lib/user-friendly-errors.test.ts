import { describe, it, expect } from 'vitest';
import { AppError, ERROR_REGISTRY } from '@/lib/errors';
import { getUserFriendlyError, getSuccessMessage } from '@/lib/user-friendly-errors';

describe('User-Friendly Error Messages', () => {
  describe('getUserFriendlyError', () => {
    it('uses the typed AppError public message', () => {
      const error = new AppError({
        code: 'SERVICE_NOT_FOUND',
        userMessage: 'The selected service no longer exists.',
      });
      expect(getUserFriendlyError(error)).toBe('The selected service no longer exists.');
    });

    it('treats explicit strings as already-public copy without translating them', () => {
      expect(getUserFriendlyError('Unauthorized')).toBe('Unauthorized');
      expect(getUserFriendlyError('Incident not found')).toBe('Incident not found');
      expect(getUserFriendlyError('Unique constraint failed on email')).toBe(
        'Unique constraint failed on email'
      );
      expect(getUserFriendlyError('Request timeout')).toBe('Request timeout');
    });

    it('does not expose untyped Error messages even when they resemble old translation rules', () => {
      const error = new Error('Unique constraint failed on the fields: (`email`)');
      expect(getUserFriendlyError(error)).toBe(ERROR_REGISTRY.INTERNAL_ERROR.userMessage);
    });

    it('does not expose arbitrary unknown objects', () => {
      const error = { message: 'postgres://secret@database' };
      expect(getUserFriendlyError(error)).toBe(ERROR_REGISTRY.INTERNAL_ERROR.userMessage);
    });

    it('uses the generic message for empty string compatibility input', () => {
      expect(getUserFriendlyError('   ')).toBe(ERROR_REGISTRY.INTERNAL_ERROR.userMessage);
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

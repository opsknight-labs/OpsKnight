import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn() } }));

import { AppError } from '@/lib/errors';
import { settingsActionFailure } from '@/lib/settings-action-errors';
import { SETTINGS_CHANGED_MESSAGE, SettingsChangedMutationError } from '@/lib/settings-result';

const options = { operation: 'example.save', fallback: 'Failed to save settings.' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings server-action failure adapter', () => {
  it('returns the AppError user message so it survives production error redaction', () => {
    expect(
      settingsActionFailure(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Provider configuration is incomplete; required fields are missing: host.',
        }),
        options
      )
    ).toEqual({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Provider configuration is incomplete; required fields are missing: host.',
    });
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('maps authorization and dependency errors to the settings error codes', () => {
    expect(
      settingsActionFailure(
        new AppError({ code: 'AUTHORIZATION_DENIED', userMessage: 'Admin access required.' }),
        options
      )
    ).toMatchObject({ code: 'FORBIDDEN', error: 'Admin access required.' });
    expect(
      settingsActionFailure(new AppError({ code: 'NOTIFICATION_PROVIDER_UNAVAILABLE' }), options)
    ).toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('reports revision conflicts with the shared settings-changed message', () => {
    for (const error of [
      new SettingsChangedMutationError(),
      new AppError({ code: 'PRECONDITION_FAILED' }),
      new AppError({ code: 'PRECONDITION_REQUIRED' }),
    ]) {
      expect(settingsActionFailure(error, options)).toEqual({
        success: false,
        code: 'SETTINGS_CHANGED',
        error: SETTINGS_CHANGED_MESSAGE,
      });
    }
  });

  it('never exposes unexpected or internal error details', () => {
    const plain = settingsActionFailure(
      new Error('Prisma P1001: cannot reach db at 10.0.0.5 with secret=abc123'),
      options
    );
    const internal = settingsActionFailure(
      new AppError({ code: 'INTERNAL_ERROR', userMessage: 'stack: at secret()' }),
      options
    );

    for (const result of [plain, internal]) {
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.error).toMatch(/^Failed to save settings\. /);
      expect(result.error).not.toMatch(/Prisma|10\.0\.0\.5|abc123|stack/);
      expect(result.reference).toMatch(/^[0-9a-f]{8}$/);
      expect(result.error).toContain(`reference ${result.reference}`);
    }
    expect(mocks.loggerError).toHaveBeenCalledTimes(2);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'settings.example.save_failed',
      expect.objectContaining({ reference: plain.reference })
    );
  });

  it('treats thrown non-Error values as unexpected', () => {
    expect(settingsActionFailure('boom', options)).toMatchObject({
      success: false,
      code: 'INTERNAL_ERROR',
    });
  });
});

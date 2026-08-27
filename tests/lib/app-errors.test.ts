import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_REGISTRY,
  normalizeError,
  toPublicAppError,
} from '@/lib/errors';

describe('AppError', () => {
  it('derives stable defaults from the error registry', () => {
    const error = new AppError({
      code: 'SCHEDULE_LAYER_USER_DUPLICATE',
      details: { scheduleId: 'schedule-1', layerId: 'layer-1', userId: 'user-1' },
    });

    expect(error.code).toBe('SCHEDULE_LAYER_USER_DUPLICATE');
    expect(error.status).toBe(409);
    expect(error.userMessage).toBe(ERROR_REGISTRY.SCHEDULE_LAYER_USER_DUPLICATE.userMessage);
    expect(error.action).toBe(ERROR_REGISTRY.SCHEDULE_LAYER_USER_DUPLICATE.action);
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({
      scheduleId: 'schedule-1',
      layerId: 'layer-1',
      userId: 'user-1',
    });
  });

  it('supports contextual public messages without changing machine identity', () => {
    const error = new AppError({
      code: 'SCHEDULE_LAYER_USER_DUPLICATE',
      userMessage: 'This responder is already assigned to Layer 1.',
    });

    expect(error.code).toBe('SCHEDULE_LAYER_USER_DUPLICATE');
    expect(error.status).toBe(409);
    expect(error.userMessage).toBe('This responder is already assigned to Layer 1.');
  });

  it('normalizes unknown exceptions to a safe internal error', () => {
    const source = new Error('postgres://user:secret@db.internal/opsknight');
    const error = normalizeError(source);

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(500);
    expect(error.userMessage).not.toContain('secret');
    expect(error.cause).toBe(source);
  });

  it('preserves compatible existing typed errors during migration', () => {
    const legacyTypedError = Object.assign(new Error('Access denied by policy.'), {
      code: 'AUTHORIZATION_DENIED' as const,
      status: 403,
    });

    const error = normalizeError(legacyTypedError);

    expect(error.code).toBe('AUTHORIZATION_DENIED');
    expect(error.status).toBe(403);
    expect(error.userMessage).toBe('Access denied by policy.');
    expect(error.cause).toBe(legacyTypedError);
  });

  it('keeps internal details out of the public serializer', () => {
    const error = new AppError({
      code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
      details: {
        provider: 'slack',
        token: 'do-not-expose',
      },
    });

    const publicError = toPublicAppError(error);

    expect(publicError).toEqual({
      code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
      message: ERROR_REGISTRY.NOTIFICATION_PROVIDER_UNAVAILABLE.userMessage,
      action: ERROR_REGISTRY.NOTIFICATION_PROVIDER_UNAVAILABLE.action,
      retryable: true,
      fields: undefined,
    });
    expect(JSON.stringify(publicError)).not.toContain('do-not-expose');
  });

  it('supports structured validation fields', () => {
    const error = new AppError({
      code: 'VALIDATION_FAILED',
      fields: [
        {
          field: 'title',
          code: 'required',
          message: 'Title is required.',
        },
      ],
    });

    expect(toPublicAppError(error).fields).toEqual([
      {
        field: 'title',
        code: 'required',
        message: 'Title is required.',
      },
    ]);
  });
});

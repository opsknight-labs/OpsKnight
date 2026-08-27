import { describe, expect, it } from 'vitest';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import {
  AppError,
  ERROR_REGISTRY,
  normalizeError,
  toPublicAppError,
} from '@/lib/errors';
import { getUserFriendlyError } from '@/lib/user-friendly-errors';

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

  it('keeps registry status authoritative even when runtime input contains a status property', () => {
    const legacyShapedOptions = {
      code: 'RESOURCE_NOT_FOUND' as const,
      status: 500,
    };

    const error = new AppError(legacyShapedOptions);

    expect(error.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.status).toBe(ERROR_REGISTRY.RESOURCE_NOT_FOUND.status);
    expect(error.status).toBe(404);
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

  it('uses AppError as the authorization contract without changing legacy messages', () => {
    const error = new AuthorizationError(
      'Unauthorized. Responder access or above required.',
      CAPABILITIES.OPERATIONS_MANAGE
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('AUTHORIZATION_DENIED');
    expect(error.status).toBe(403);
    expect(error.details).toEqual({ capability: CAPABILITIES.OPERATIONS_MANAGE });
    expect(getUserFriendlyError(error)).toBe('Unauthorized. Responder access or above required.');
  });

  it('registers lifecycle codes so existing domain errors normalize without losing identity', () => {
    const lifecycleError = Object.assign(new Error('Incident changed; refresh before updating.'), {
      code: 'INCIDENT_STATE_CONFLICT' as const,
      status: 409,
      details: { incidentId: 'inc-1', expectedStatus: 'OPEN', actualStatus: 'ACKNOWLEDGED' },
    });

    const error = normalizeError(lifecycleError);

    expect(error.code).toBe('INCIDENT_STATE_CONFLICT');
    expect(error.status).toBe(409);
    expect(error.userMessage).toBe('Incident changed; refresh before updating.');
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

  it('enforces internal exposure and cannot leak caller-supplied public data', () => {
    const error = new AppError({
      code: 'INTERNAL_ERROR',
      userMessage: 'secret-provider-response',
      action: 'send-secret-token',
      fields: [
        {
          field: 'token',
          message: 'secret-field-value',
        },
      ],
      details: { token: 'secret-details-token' },
    });

    const publicError = toPublicAppError(error);
    const serialized = JSON.stringify(publicError);

    expect(publicError).toEqual({
      code: 'INTERNAL_ERROR',
      message: ERROR_REGISTRY.INTERNAL_ERROR.userMessage,
      action: ERROR_REGISTRY.INTERNAL_ERROR.action,
      retryable: true,
      fields: undefined,
    });
    expect(serialized).not.toContain('secret-provider-response');
    expect(serialized).not.toContain('send-secret-token');
    expect(serialized).not.toContain('secret-field-value');
    expect(serialized).not.toContain('secret-details-token');
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

  it('uses distinct machine identities for core incident and schedule access failures', () => {
    expect(ERROR_REGISTRY.INCIDENT_NOT_FOUND.status).toBe(404);
    expect(ERROR_REGISTRY.INCIDENT_ACCESS_DENIED.status).toBe(403);
    expect(ERROR_REGISTRY.INCIDENT_MODIFY_DENIED.status).toBe(403);
    expect(ERROR_REGISTRY.SCHEDULE_NOT_FOUND.status).toBe(404);
    expect(ERROR_REGISTRY.SCHEDULE_ACCESS_DENIED.status).toBe(403);
    expect(ERROR_REGISTRY.SCHEDULE_LAYER_USER_DUPLICATE.status).toBe(409);
  });
});

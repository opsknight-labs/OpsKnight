import { describe, expect, it } from 'vitest';
import {
  ClientAppError,
  errorFromResponse,
  extractStructuredError,
  toClientAppError,
} from '@/lib/client-error';

describe('client error adapter', () => {
  it('extracts the public typed error contract', () => {
    expect(
      extractStructuredError({
        error: 'Required incident fields are missing.',
        code: 'INCIDENT_REQUIRED_FIELDS_MISSING',
        action: 'Complete the required fields and try again.',
        retryable: false,
        fields: [{ field: 'summary', message: 'Summary is required.' }],
      })
    ).toEqual({
      error: 'Required incident fields are missing.',
      code: 'INCIDENT_REQUIRED_FIELDS_MISSING',
      action: 'Complete the required fields and try again.',
      retryable: false,
      fields: [{ field: 'summary', message: 'Summary is required.' }],
    });
  });

  it('ignores unknown machine codes while preserving the legacy message', () => {
    expect(
      extractStructuredError({
        error: 'Legacy failure',
        code: 'NOT_A_REAL_CODE',
      })
    ).toEqual({
      error: 'Legacy failure',
      code: undefined,
      action: undefined,
      retryable: undefined,
      fields: undefined,
    });
  });

  it('preserves typed metadata from a failed fetch response', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'The incident status changed before this action completed.',
        code: 'INCIDENT_TRANSITION_CONFLICT',
        action: 'Refresh the incident and try again.',
        retryable: true,
        fields: [{ field: 'status', message: 'Status is stale.' }],
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const error = await errorFromResponse(response);

    expect(error).toBeInstanceOf(ClientAppError);
    expect(error.message).toBe('The incident status changed before this action completed.');
    expect(error.code).toBe('INCIDENT_TRANSITION_CONFLICT');
    expect(error.action).toBe('Refresh the incident and try again.');
    expect(error.retryable).toBe(true);
    expect(error.fields).toEqual([{ field: 'status', message: 'Status is stale.' }]);
  });

  it('keeps legacy errors usable when no structured payload exists', () => {
    const error = toClientAppError(new Error('Failed to fetch'));
    expect(error.message).toBe('Failed to fetch');
    expect(error.code).toBeUndefined();
  });
});

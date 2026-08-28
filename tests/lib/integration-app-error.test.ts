import { describe, expect, it } from 'vitest';
import { IntegrationErrors } from '@/lib/integrations/errors';
import { integrationErrorToAppError } from '@/lib/integrations/app-error';

const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

describe('integration AppError adapter', () => {
  it('maps invalid payloads without inferring semantics from message text', () => {
    const error = IntegrationErrors.invalidPayload('Invalid JSON in request body');
    const appError = integrationErrorToAppError(error);

    expect(appError).toMatchObject({
      code: 'INTEGRATION_PAYLOAD_INVALID',
      status: 400,
      userMessage: LEGACY_INVALID_INPUT_MESSAGE,
    });
  });

  it('maps not-found errors while preserving the legacy client-visible message', () => {
    const appError = integrationErrorToAppError(IntegrationErrors.notFound('integration-1'));

    expect(appError).toMatchObject({
      code: 'INTEGRATION_NOT_FOUND',
      status: 404,
      userMessage: LEGACY_NOT_FOUND_MESSAGE,
    });
  });

  it('maps signature failures to stable authentication codes', () => {
    const appError = integrationErrorToAppError(IntegrationErrors.invalidSignature());

    expect(appError).toMatchObject({
      code: 'INTEGRATION_SIGNATURE_INVALID',
      status: 401,
    });
  });

  it('leaves dedicated rate-limit and internal handling untouched', () => {
    expect(integrationErrorToAppError(IntegrationErrors.rateLimited(30))).toBeNull();
    expect(integrationErrorToAppError(IntegrationErrors.internal('provider failed'))).toBeNull();
  });
});

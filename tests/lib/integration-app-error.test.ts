import { describe, expect, it } from 'vitest';
import { ERROR_REGISTRY } from '@/lib/errors';
import { IntegrationErrors } from '@/lib/integrations/errors';
import { integrationErrorToAppError } from '@/lib/integrations/app-error';

describe('integration AppError adapter', () => {
  it('maps invalid payloads to registry-owned public semantics', () => {
    const error = IntegrationErrors.invalidPayload('Invalid JSON in request body');
    const appError = integrationErrorToAppError(error);

    expect(appError).toMatchObject({
      code: 'INTEGRATION_PAYLOAD_INVALID',
      status: 400,
      userMessage: ERROR_REGISTRY.INTEGRATION_PAYLOAD_INVALID.userMessage,
    });
  });

  it('maps not-found errors to registry-owned public semantics', () => {
    const appError = integrationErrorToAppError(IntegrationErrors.notFound('integration-1'));

    expect(appError).toMatchObject({
      code: 'INTEGRATION_NOT_FOUND',
      status: 404,
      userMessage: ERROR_REGISTRY.INTEGRATION_NOT_FOUND.userMessage,
    });
  });

  it('does not expose the integration exception message as public AppError copy', () => {
    const source = IntegrationErrors.unauthorized('provider-secret-auth-detail');
    const appError = integrationErrorToAppError(source);

    expect(appError?.userMessage).toBe(ERROR_REGISTRY.INTEGRATION_AUTHENTICATION_FAILED.userMessage);
    expect(appError?.userMessage).not.toContain('provider-secret-auth-detail');
    expect(appError?.cause).toBe(source);
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

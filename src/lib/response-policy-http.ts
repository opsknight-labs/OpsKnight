import { ZodError } from 'zod';
import { jsonError } from '@/lib/api-response';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';
import { logger } from '@/lib/logger';

export function responsePolicyError(error: unknown, invalidMessage: string) {
  if (error instanceof SyntaxError || error instanceof ZodError)
    return jsonError(invalidMessage, 400);
  if (error instanceof IncidentResponsePolicyError) {
    if (error.code === 'CONFLICT') return jsonError('Policy version conflict', 409);
    if (error.code === 'NOT_FOUND') return jsonError('Policy resource not found', 404);
    if (error.code === 'UNAUTHORIZED') return jsonError('Admin access required', 403);
  }
  logger.error('response_policy.api_failed', { error });
  return jsonError('Response-policy operation failed', 500);
}

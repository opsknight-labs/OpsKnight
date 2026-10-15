import type { NextRequest } from 'next/server';
import { withRequestContext } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { V2_OPERATIONS } from './openapi-registry';

/**
 * REST v2 observability.
 *
 * Every route is wrapped so it gets request correlation, the shared HTTP request
 * counter, latency histogram and in-flight gauge, labelled with the operationId
 * (a bounded set), never a raw URL, identifier, credential or client address.
 * Authentication, rate-limit, error and idempotency outcomes are counted at the
 * point they are decided. All label values come from fixed vocabularies.
 */

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const matchers = [...V2_OPERATIONS]
  .map(definition => ({
    method: definition.method.toUpperCase(),
    operationId: definition.operationId,
    params: (definition.path.match(/\{/g) ?? []).length,
    pattern: new RegExp(
      '^/api/v2' +
        // Escape every regex metacharacter (including backslash and `.`) in the literal
        // segments, then substitute each {param} with a single-segment wildcard.
        definition.path.split(/\{\w+\}/).map(escapeRegExp).join('[^/]+') +
        '/?$'
    ),
  }))
  // Prefer the most literal route when a path could match several templates.
  .sort((a, b) => a.params - b.params);

export function resolveOperationId(method: string, pathname: string): string | null {
  const upper = method.toUpperCase();
  return matchers.find(m => m.method === upper && m.pattern.test(pathname))?.operationId ?? null;
}

type RouteHandler<A extends unknown[]> = (req: NextRequest, ...args: A) => Promise<Response>;

export function withV2Observability<A extends unknown[]>(
  handler: RouteHandler<A>
): RouteHandler<A> {
  return (req, ...args) => {
    let operationId: string | null = null;
    try {
      operationId = resolveOperationId(req.method, new URL(req.url).pathname);
    } catch {
      operationId = null;
    }
    return withRequestContext(handler, `api_v2.${operationId ?? 'unmatched'}`)(req, ...args);
  };
}

export type V2AuthFailureReason =
  | 'missing_credentials'
  | 'malformed_token'
  | 'invalid_token'
  | 'inactive_principal'
  | 'ip_throttled'
  | 'legacy_throttled'
  | 'verification_busy';

export function recordAuthFailure(reason: V2AuthFailureReason) {
  addOperationalMetric('opsknight_api_v2_auth_failures_total', 1, { reason });
}

export function recordRateLimitDecision(tier: string, allowed: boolean) {
  addOperationalMetric('opsknight_api_v2_rate_limit_decisions_total', 1, {
    tier: tier.toLowerCase(),
    decision: allowed ? 'allowed' : 'limited',
  });
}

export function recordIdempotency(result: 'replayed' | 'conflict') {
  addOperationalMetric('opsknight_api_v2_idempotency_total', 1, { result });
}

export function recordApiError(category: string, status: number) {
  addOperationalMetric('opsknight_api_v2_errors_total', 1, {
    category,
    status_class: `${Math.floor(status / 100)}xx`,
  });
}

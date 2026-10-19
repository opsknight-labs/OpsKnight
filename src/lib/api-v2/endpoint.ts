/* eslint-disable @typescript-eslint/no-explicit-any -- arbitrary JSON documents / erased generic route plumbing */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateV2Request, type V2ApiKeyIdentity } from './auth';
import { enforceV2RateLimit, type V2OperationClass } from './rate-limit';
import { enforceV2Authorization, enforceV2ResourceAuthorization } from './rbac';
import { readV2JsonBody } from './request-body';
import { requireRevisionIfMatch } from './concurrency';
import { apiV2Success, apiV2Created, apiV2NoContent, apiV2Error } from './response';
import { runV2IdempotentMutation, idempotencyResponseHeaders } from './idempotency';
import { parsePaginationParams } from './pagination';
import type { ApiV2Pagination } from './types';
import type {
  AuthorizationAction,
  AuthorizationActor,
  AuthorizationResource,
} from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from './observability';
import type { Prisma } from '@prisma/client';

export interface V2RouteContext<TParams = any, TQuery = any, TBody = any> {
  req: NextRequest;
  params: TParams;
  query: TQuery;
  body: TBody;
  pagination: { limit: number; cursor: string | null };
  actor: AuthorizationActor;
  apiKey: V2ApiKeyIdentity;
  rateLimitHeaders: Record<string, string>;
  tx?: Prisma.TransactionClient;
}

export type V2RouteHandlerResult<TResult = any> =
  | {
      status?: number;
      data?: TResult;
      pagination?: ApiV2Pagination;
      headers?: Record<string, string>;
    }
  | Response;

export type V2RouteConfig<TParams = any, TQuery = any, TBody = any, TResult = any> = {
  rateLimitTier?: V2OperationClass;
  resourceExtractor?: (
    ctx: Omit<V2RouteContext<TParams, TQuery, TBody>, 'rateLimitHeaders' | 'tx'>
  ) => Promise<AuthorizationResource | undefined> | AuthorizationResource | undefined;
  paramsSchema?: z.ZodType<TParams, any, any>;
  querySchema?: z.ZodType<TQuery, any, any>;
  bodySchema?: z.ZodType<TBody, any, any>;
  preconditionRequired?: boolean;
  idempotent?: boolean;
  idempotencyRequired?: boolean;
  idempotencyScope?: string | ((ctx: { params: TParams; body: TBody }) => string);
  /**
   * Optional resource-level authorization re-check executed before a cached
   * idempotency result is returned. Runs inside the serializable replay transaction
   * with a current database snapshot so it reads the authoritative membership/ownership
   * state. Throw an AppError to deny replay (e.g. after team membership is revoked).
   * Without this guard, callers whose access was removed after the first successful
   * write can receive the stored response indefinitely.
   */
  replayAuthGuard?: (
    ctx: Omit<V2RouteContext<TParams, TQuery, TBody>, 'rateLimitHeaders'>
  ) => Promise<void>;
  /** Transform secret-bearing inputs before fingerprinting; never persist an unkeyed secret digest. */
  idempotencyPayload?: (
    ctx: Pick<V2RouteContext<TParams, TQuery, TBody>, 'req' | 'params' | 'body'>
  ) => Prisma.InputJsonValue;
  /** One-time disclosure routes persist safe replay metadata, never their initial secret. */
  persistIdempotencyResult?: (
    result: V2RouteHandlerResult<TResult>
  ) => V2RouteHandlerResult<TResult>;
  /** Synchronous local cache eviction only, after the mutation transaction commits (also on replay). */
  invalidateAfterCommit?: (result: V2RouteHandlerResult<TResult>) => void;
  scopedFilter?: boolean;
  handler: (ctx: V2RouteContext<TParams, TQuery, TBody>) => Promise<V2RouteHandlerResult<TResult>>;
} & (
  | {
      action: AuthorizationAction;
      isPublic?: false;
    }
  | {
      action?: never;
      isPublic: true;
    }
);

export type NextRouteHandler = (
  req: NextRequest,
  context?: { params?: Promise<Record<string, string>> | Record<string, string> }
) => Promise<Response>;

/**
 * Declarative route factory for OpsKnight Public REST API v2.
 * Centralizes Authentication, Rate-limiting, RBAC scope enforcement,
 * Zod validation, Transactional idempotency, and RFC 9457 error serialization.
 */
export function defineV2Route<TParams = any, TQuery = any, TBody = any, TResult = any>(
  config: V2RouteConfig<TParams, TQuery, TBody, TResult>
): NextRouteHandler {
  return withV2Observability(
    async (
      req: NextRequest,
      context?: { params?: Promise<Record<string, string>> | Record<string, string> }
    ) => {
      try {
        // 1. Authenticate API Key or Service Account Token
        const { apiKey, actor } = await authenticateV2Request(req);

        // 2. Determine Rate Limit tier (default to READ for GET, WRITE for mutations)
        const tier: V2OperationClass =
          config.rateLimitTier ?? (req.method === 'GET' ? 'READ' : 'WRITE');
        const rateLimitHeaders = await enforceV2RateLimit(apiKey.id, tier);

        // Reject missing scopes/capabilities before parsing input or looking up resources.
        if (config.action) enforceV2Authorization(actor, config.action);

        // 3. Resolve and validate route params (if any)
        const rawParams = context?.params ? await Promise.resolve(context.params) : {};
        const params: TParams = config.paramsSchema
          ? config.paramsSchema.parse(rawParams)
          : (rawParams as TParams);

        // 4. Resolve query and pagination
        const { searchParams } = new URL(req.url);
        const pagination = parsePaginationParams(searchParams);
        if ([...searchParams.keys()].some(key => searchParams.getAll(key).length > 1)) {
          throw new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'Query parameters must not be repeated.',
          });
        }
        const queryParams = Object.fromEntries(searchParams.entries());
        const query: TQuery = config.querySchema
          ? config.querySchema.parse(queryParams)
          : (queryParams as TQuery);

        // 5. Parse request body if schema is defined
        let body: TBody = undefined as unknown as TBody;
        if (config.bodySchema) {
          const rawBody = await readV2JsonBody(req);
          body = config.bodySchema.parse(rawBody);
        }

        // 6. Enforce RBAC Scope & Capability Check
        if ('action' in config && config.action) {
          let resource: AuthorizationResource | undefined = undefined;
          if (config.resourceExtractor) {
            resource = await config.resourceExtractor({
              req,
              params,
              query,
              body,
              pagination,
              actor,
              apiKey,
            });
          }
          if (config.scopedFilter) {
            enforceV2Authorization(actor, config.action, resource);
          } else {
            enforceV2ResourceAuthorization(actor, config.action, resource);
          }
        } else if (!('isPublic' in config && config.isPublic)) {
          throw new AppError({
            code: 'AUTHORIZATION_DENIED',
            userMessage:
              'Route configuration error: authorization action is required unless isPublic: true is explicitly declared.',
          });
        }

        const expectedRevision = config.preconditionRequired
          ? requireRevisionIfMatch(req)
          : undefined;

        // 7. Execute Handler (Idempotent vs Non-Idempotent)
        if (config.idempotent) {
          if (config.idempotencyRequired) {
            const idempotencyKey = req.headers.get('idempotency-key')?.trim();
            if (!idempotencyKey) {
              throw new AppError({
                code: 'IDEMPOTENCY_KEY_REQUIRED',
                userMessage: 'The Idempotency-Key header is required for this operation.',
              });
            }
          }

          const scope =
            typeof config.idempotencyScope === 'function'
              ? config.idempotencyScope({ params, body })
              : (config.idempotencyScope ?? `${req.method}:${new URL(req.url).pathname}`);

          const receiptPayload = config.idempotencyPayload
            ? config.idempotencyPayload({ req, params, body })
            : body;
          const execution = await runV2IdempotentMutation(
            req,
            apiKey.id,
            scope,
            expectedRevision === undefined
              ? receiptPayload
              : { contract: 'revision-bound-v1', body: receiptPayload, ifMatch: expectedRevision },
            async tx => {
              return await config.handler({
                req,
                params,
                query,
                body,
                pagination,
                actor,
                apiKey,
                rateLimitHeaders,
                tx,
              });
            },
            config.replayAuthGuard
              ? async tx => {
                  await config.replayAuthGuard!({
                    req,
                    params,
                    query,
                    body,
                    pagination,
                    actor,
                    apiKey,
                    tx,
                  });
                }
              : undefined,
            config.persistIdempotencyResult
          );

          const result = execution.value;
          config.invalidateAfterCommit?.(result);
          if (result instanceof Response) {
            return result;
          }

          const mergedHeaders = {
            ...rateLimitHeaders,
            ...idempotencyResponseHeaders(execution.replayed),
            ...(result.headers ?? {}),
          };

          if (result.status === 201) {
            return apiV2Created(result.data, {
              pagination: result.pagination,
              headers: mergedHeaders,
            });
          }
          if (result.status === 204) {
            return apiV2NoContent(mergedHeaders);
          }
          return apiV2Success(result.data, {
            pagination: result.pagination,
            headers: mergedHeaders,
            status: result.status,
          });
        }

        // Non-idempotent execution
        const result = await config.handler({
          req,
          params,
          query,
          body,
          pagination,
          actor,
          apiKey,
          rateLimitHeaders,
        });

        if (result instanceof Response) {
          return result;
        }

        const mergedHeaders = {
          ...rateLimitHeaders,
          ...(result.headers ?? {}),
        };

        if (result.status === 201) {
          return apiV2Created(result.data, {
            pagination: result.pagination,
            headers: mergedHeaders,
          });
        }
        if (result.status === 204) {
          return apiV2NoContent(mergedHeaders);
        }
        return apiV2Success(result.data, {
          pagination: result.pagination,
          headers: mergedHeaders,
          status: result.status,
        });
      } catch (error) {
        return apiV2Error(error, req);
      }
    }
  );
}

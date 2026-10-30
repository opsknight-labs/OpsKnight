import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '@/lib/api-v2/mutation-contract';
import reviewJson from './review.json';
import { requireMcp } from '../core/errors';
import { createHash } from 'node:crypto';
import { operationReviewSchema, type OperationReview } from './review-schema';
import { isApiScope } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  apiScopeForAction,
  type AuthorizationAction,
} from '@/lib/authorization-policy';

export type JsonObject = { [key: string]: unknown };
const canonicalActions = new Map<string, AuthorizationAction>(
  Object.values(AUTHORIZATION_ACTIONS).map(action => [action, action])
);
const reviews = new Map<string, OperationReview>(
  Object.entries(reviewJson).map(([id, review]) => [id, operationReviewSchema.parse(review)])
);
requireMcp(
  new Set(V2_OPERATIONS.map(operation => operation.operationId)).size === V2_OPERATIONS.length,
  'MCP_DUPLICATE_OPERATION'
);
const spec = getOpenApiV2Spec() as unknown as {
  paths: Record<string, Record<string, JsonObject>>;
  components: { schemas: Record<string, JsonObject> };
};
const schemas = new Map(Object.entries(spec.components.schemas));
const paths = new Map(Object.entries(spec.paths));
const mutations = new Map(Object.entries(V2_MUTATION_CONTRACT));

function resolveSchema(
  value: unknown,
  depth = 0,
  definitions = new Map<string, JsonObject>()
): JsonObject {
  requireMcp(depth <= 24, 'MCP_SCHEMA_DEPTH');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const schema = value as JsonObject;
  if (typeof schema.$ref === 'string') {
    requireMcp(schema.$ref.startsWith('#/components/schemas/'), 'MCP_SCHEMA_REFERENCE');
    const name = schema.$ref.slice('#/components/schemas/'.length);
    const resolved = schemas.get(name);
    requireMcp(resolved, 'MCP_SCHEMA_REFERENCE');
    if (!definitions.has(name)) {
      definitions.set(name, {});
      definitions.set(name, resolveSchema(resolved, 0, definitions));
    }
    return { $ref: `#/$defs/${name}` };
  }
  const result: JsonObject = { ...schema };
  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [
        key,
        resolveSchema(child, depth + 1, definitions),
      ])
    );
    result.additionalProperties = false;
  }
  if (schema.items) result.items = resolveSchema(schema.items, depth + 1, definitions);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const children = new Map(Object.entries(schema)).get(key);
    if (Array.isArray(children))
      Object.assign(result, {
        [key]: children.map(child => resolveSchema(child, depth + 1, definitions)),
      });
  }
  return result;
}

export const MCP_CATALOG = V2_OPERATIONS.map(operation => {
  const review = reviews.get(operation.operationId);
  requireMcp(review, `MCP_UNCLASSIFIED_${operation.operationId}`);
  const authorizationActions = review.actions.map(name => {
    const action = canonicalActions.get(name);
    requireMcp(action, `MCP_UNKNOWN_ACTION_${operation.operationId}`);
    return action;
  });
  const requiredScopes = [
    ...new Set([
      operation.scope,
      ...authorizationActions.flatMap(action => {
        const scope = apiScopeForAction(action);
        return scope ? [scope] : [];
      }),
      ...(review.additionalScopes ?? []).map(scope => {
        requireMcp(isApiScope(scope), `MCP_UNKNOWN_SCOPE_${operation.operationId}`);
        return scope;
      }),
    ]),
  ].sort();
  const pathItem = paths.get(operation.path);
  const contract = pathItem && new Map(Object.entries(pathItem)).get(operation.method);
  requireMcp(contract, `MCP_MISSING_SCHEMA_${operation.operationId}`);
  const parameters = (contract.parameters ?? []) as {
    in: string;
    name: string;
    required?: boolean;
    schema?: JsonObject;
  }[];
  const definitions = new Map<string, JsonObject>();
  const parameterSchema = (location: string) => ({
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      parameters
        .filter(p => p.in === location)
        .map(p => [p.name, resolveSchema(p.schema, 0, definitions)])
    ),
    required: parameters.filter(p => p.in === location && p.required).map(p => p.name),
  });
  const requestBody = contract.requestBody as
    { required?: boolean; content?: Record<string, { schema?: JsonObject }> } | undefined;
  const bodySchema = requestBody?.content?.['application/json']?.schema;
  const properties: JsonObject = { path: parameterSchema('path'), query: parameterSchema('query') };
  if (bodySchema) properties.body = resolveSchema(bodySchema, 0, definitions);
  const mutation =
    mutations.get(
      `${operation.method.toUpperCase()} /api/v2${operation.path.replace(/\{(\w+)\}/g, '[$1]')}`
    ) ?? null;
  // Reads never take an idempotency key or revision precondition, whatever their risk class.
  const writes = operation.method !== 'get' && !review.sideEffectFree;
  if (review.risk !== 'R0' && writes) {
    properties.idempotencyKey = {
      type: 'string',
      minLength: 16,
      maxLength: 128,
      pattern: '^[A-Za-z0-9_-]+$',
    };
  }
  if ((review.risk !== 'R0' && writes) || mutation?.preconditionRequired)
    properties.ifMatch = { type: 'string', maxLength: 128 };
  return {
    ...operation,
    // Descriptive only: not a contract hash input, so rewording a summary never unreviews an operation.
    summary: typeof contract.summary === 'string' ? contract.summary : undefined,
    authorizationActions,
    requiredScopes,
    ...review,
    domain: operation.path.split('/')[1],
    mutation,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties,
      $defs: Object.fromEntries(definitions),
      required: [
        ...(operation.path.includes('{') ? ['path'] : []),
        ...(requestBody?.required ? ['body'] : []),
        ...(review.risk !== 'R0' && writes ? ['idempotencyKey'] : []),
        ...(mutation?.preconditionRequired ? ['ifMatch'] : []),
      ],
    },
    outputSchema: contract.responses,
  };
}).sort((a, b) => a.operationId.localeCompare(b.operationId));

requireMcp(reviews.size === MCP_CATALOG.length, 'MCP_STALE_REVIEW');
export function mcpContractHash(operation: (typeof MCP_CATALOG)[number]) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        method: operation.method,
        authorizationActions: operation.authorizationActions,
        requiredScopes: operation.requiredScopes,
        path: operation.path,
        scope: operation.scope,
        inputSchema: operation.inputSchema,
        outputSchema: operation.outputSchema,
        mutation: operation.mutation,
      })
    )
    .digest('hex');
}
// Versioned static metadata only. Do not hash the whole OpenAPI projection per request.
const reviewedContracts = new Set(
  MCP_CATALOG.filter(operation => mcpContractHash(operation) === operation.contractSha256)
);
export const MCP_OPERATION_MAP = new Map(
  MCP_CATALOG.map(operation => [operation.operationId, operation])
);
/** A non-GET read must be reviewed side-effect free and carry a receipt-less, unfenced contract. */
export function isMcpSideEffectFreeRead(operation: (typeof MCP_CATALOG)[number]) {
  return (
    operation.method === 'get' ||
    (operation.sideEffectFree === true &&
      operation.method === 'post' &&
      operation.mutation?.idempotency === 'natural' &&
      operation.mutation.concurrency === 'none' &&
      !operation.mutation.preconditionRequired)
  );
}
export function isMcpSensitiveRead(operation: (typeof MCP_CATALOG)[number]) {
  return operation.status === 'SENSITIVE_READ' && isMcpSideEffectFreeRead(operation);
}
export function isMcpExecutable(operation: (typeof MCP_CATALOG)[number]) {
  return (
    (operation.status === 'CURATED' ||
      operation.status === 'DISCOVERABLE' ||
      isMcpSensitiveRead(operation)) &&
    reviewedContracts.has(operation)
  );
}

/** Callable only through the frozen prepare, native review and commit workflow. */
export function isMcpApprovalGated(operation: (typeof MCP_CATALOG)[number]) {
  return (
    operation.status === 'APPROVAL_REQUIRED' &&
    (operation.risk === 'R2' || (operation.risk === 'R3' && Boolean(operation.impactPreview))) &&
    operation.method !== 'get' &&
    reviewedContracts.has(operation)
  );
}

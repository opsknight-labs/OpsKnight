type ObjectSchema = {
  properties?: Record<string, { required?: unknown } | undefined>;
  required?: unknown;
};

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export type RequiredArguments = {
  /** Path parameters the call needs, usually `["id"]`. */
  path: string[];
  /** Query parameters the call needs. */
  query: string[];
  /** The call needs a request `body`. */
  body: boolean;
  /** A change: send a unique `idempotencyKey` (and `ifMatch` when listed). */
  idempotencyKey: boolean;
  ifMatch: boolean;
};

/**
 * What an assistant must pass to call an operation, read from its catalog input schema. Lets a
 * search result carry the arguments, so a long-tail read takes two calls (search, then read) instead
 * of three (search, describe, read). Hints only: execution still validates against the full schema.
 */
export function requiredArgumentsOf(inputSchema: unknown): RequiredArguments {
  const root = (inputSchema ?? {}) as ObjectSchema;
  const top = names(root.required);
  return {
    path: names(root.properties?.path?.required),
    query: names(root.properties?.query?.required),
    body: top.includes('body'),
    idempotencyKey: top.includes('idempotencyKey'),
    ifMatch: top.includes('ifMatch'),
  };
}

/** The same hints with empty parts left out, to keep search results small. */
export function compactRequiredArguments(inputSchema: unknown) {
  const hints = requiredArgumentsOf(inputSchema);
  return {
    ...(hints.path.length ? { path: hints.path } : {}),
    ...(hints.query.length ? { query: hints.query } : {}),
    ...(hints.body ? { body: true } : {}),
    ...(hints.idempotencyKey ? { idempotencyKey: true } : {}),
    ...(hints.ifMatch ? { ifMatch: true } : {}),
  };
}

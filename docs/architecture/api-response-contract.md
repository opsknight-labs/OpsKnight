# API response contract

OpsKnight-owned JSON endpoints use the response boundary in
`src/lib/api-response.ts`. Protocol endpoints such as OAuth callbacks, Slack
interactions, streaming responses, webhooks, and binary downloads may retain
their protocol-defined response shape.

## Success

Every success response carries `success`, `data`, `dataState`, `requestId`, and
`timestamp`. List responses may add either offset or cursor `pagination` and all
responses may include structured `warnings`.

During migration, object payload properties are also emitted at the top level
so existing clients continue to work. New clients must read the `data` field.

## Error

Every error response carries `success: false`, `dataState: "unavailable"`, a
safe public `error` message, a machine-readable `code`, `retryable`, `requestId`,
and `timestamp`. Typed `AppError` values remain the only supported way to define
new error semantics. `LEGACY_API_ERROR` identifies an existing string response
that still needs conversion to an error-registry code.

## Correlation

Create one response context from the incoming request and reuse it for every
return path. The request ID is returned in both the envelope and the
`x-request-id` header. Untrusted request IDs are rejected and replaced with a
UUID.

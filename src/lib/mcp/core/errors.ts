export class McpBoundaryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    /** Set only from a domain conflict's own retryability; never from free-form details. */
    public readonly retryable?: boolean,
    /**
     * A short correction an agent can act on, built only from the caller's own input and static
     * contract metadata. Never domain data, problem details or secrets.
     */
    public readonly hint?: string
  ) {
    super(code);
  }
}

export function requireMcp(
  condition: unknown,
  code: string,
  status = 400,
  hint?: string
): asserts condition {
  if (!condition) throw new McpBoundaryError(code, status, undefined, hint);
}

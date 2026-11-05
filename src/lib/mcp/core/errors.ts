/**
 * Typed facts a domain rejection may carry to an agent. Each value is validated against static
 * contract metadata before it is set; problem titles, details and messages never are.
 */
export interface McpBoundaryDetails {
  /** A code from the application ERROR_REGISTRY, never a free-form string. */
  domainCode?: string;
  /** Which input fields failed and the registry-style rule each failed. */
  fields?: { field: string; code: string }[];
  /** Seconds the caller should wait, from a 429 or 503. */
  retryAfterSeconds?: number;
}

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
    public readonly hint?: string,
    public readonly details: McpBoundaryDetails = {}
  ) {
    super(code);
  }
  get domainCode() {
    return this.details.domainCode;
  }
  get fields() {
    return this.details.fields;
  }
  get retryAfterSeconds() {
    return this.details.retryAfterSeconds;
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

/** Fixed diagnostic vocabulary. Exception messages can contain source data or provider payloads. */
const SUMMARIES = {
  WORK_BUDGET: 'Processing exceeded its time budget.',
  DB_BUSY: 'The database could not complete the work within its contention or time limits.',
  AI_LIMIT: 'The configured AI usage limit was reached.',
  AI_UNAVAILABLE: 'An eligible AI provider could not complete the request.',
  INVALID_INPUT: 'The work did not pass input validation.',
  CANCELLED: 'Processing was cancelled.',
  UNKNOWN: 'The work could not be completed. Detailed exception text is withheld.',
} as const;
export type WorkFailureCode = keyof typeof SUMMARIES;
const PREFIX = 'work:v1:';

/** Classify only known codes/names; never stringify an exception or inspect its free-text payload. */
export function encodeWorkFailure(error: unknown): string {
  let category: WorkFailureCode = 'UNKNOWN';
  try {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (error instanceof Error && error.name === 'WorkTimeoutError') category = 'WORK_BUDGET';
    else if (
      typeof code === 'string' &&
      ['P2024', 'P2034', '57014', '55P03', '40P01', '40001'].includes(code)
    )
      category = 'DB_BUSY';
    else if (code === 'RATE_LIMITED' || code === 'BUDGET_EXHAUSTED') category = 'AI_LIMIT';
    else if (code === 'NO_PROVIDER' || code === 'ALL_PROVIDERS_FAILED') category = 'AI_UNAVAILABLE';
    else if (code === 'ABORTED' || (error instanceof Error && error.name === 'AbortError'))
      category = 'CANCELLED';
    else if (error instanceof Error && error.name === 'ZodError') category = 'INVALID_INPUT';
  } catch {
    // Even malformed error objects must not prevent a claim from being released.
  }
  return `${PREFIX}${category}`;
}

/** Legacy exception text is deliberately not echoed, parsed for hints, or exposed in the DTO. */
export function describeWorkFailure(stored: string | null) {
  const entry = Object.entries(SUMMARIES).find(([code]) => stored === `${PREFIX}${code}`);
  return {
    failureCode: (entry?.[0] ?? 'UNKNOWN') as WorkFailureCode,
    failureSummary: entry?.[1] ?? SUMMARIES.UNKNOWN,
  };
}

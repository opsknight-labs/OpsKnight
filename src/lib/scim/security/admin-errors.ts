import { ZodError } from 'zod/v3';
export type ScimAdminFailure = { scimError: string };
/** Return actionable expected failures without leaking database errors through Server Actions. */
export function adminFailure(error: unknown): ScimAdminFailure {
  if (error instanceof ZodError)
    return {
      scimError: error.issues
        .map(issue => `${issue.path.join('.') || 'Input'}: ${issue.message}`)
        .join('; '),
    };
  if (
    error instanceof Error &&
    /^(Sign in again|Fresh administrator|Administrator|Unauthorized|Membership or operational impact changed|Verify your emergency)/.test(
      error.message
    )
  )
    return { scimError: error.message };
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'P2002')
    return {
      scimError:
        'This directory identity or account is already bound. Review its existing source before approving another binding.',
    };
  if (code === 'P2025')
    return {
      scimError:
        'The selected resource no longer exists. Refresh the workspace and select it again.',
    };
  return {
    scimError:
      'SCIM administration is temporarily unavailable. Retry the operation and check server diagnostics if it continues.',
  };
}

import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { jsonApiOk, jsonError } from '@/lib/api-response';
import { getControlActor } from '@/lib/auth-control/actor';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { diagnosticQuerySchema } from '@/lib/auth-control/diagnostic-contract';
import { authenticationDiagnosticPage } from '@/lib/auth-control/diagnostic-queries';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await getControlActor();
  } catch {
    return jsonError(
      'An active administrator or restricted recovery session is required.',
      403,
      undefined,
      headers
    );
  }
  try {
    const query = diagnosticQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (
      !(
        await consumeAuthRateLimit(
          'auth-control-diagnostics',
          `${actor.kind}:${actor.id}`,
          120,
          60000
        )
      ).allowed
    )
      return jsonError('Too many diagnostic reads. Retry shortly.', 429, undefined, headers);
    return jsonApiOk(await authenticationDiagnosticPage(actor, query), { headers });
  } catch (error) {
    if (error instanceof ZodError)
      return jsonError('Check the diagnostic filters and date range.', 400, undefined, headers);
    if (error instanceof Error && /cursor|diagnostic page/.test(error.message))
      return jsonError(error.message, 400, undefined, headers);
    return jsonError(
      'Diagnostics are temporarily unavailable. Retry this page; your filters are retained.',
      503,
      undefined,
      headers
    );
  }
}

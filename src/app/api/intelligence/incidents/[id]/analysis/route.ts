import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/request-body';
import { readIncidentAnalysisState } from '@/lib/intelligence/analysis/view';
import { requestIncidentAnalysis } from '@/lib/intelligence/analysis/request';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };
const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
type Context = { params: Promise<{ id: string }> };
const deny = (status: number, message: string) => jsonError(message, status, undefined, HEADERS);
async function authenticate(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return deny(403, 'Cross-site requests are not allowed');
  try {
    const actor = await getCurrentAuthorizationActor();
    if (actor.apiKey || actor.status !== 'ACTIVE')
      return deny(403, 'Analysis is only available to active app sessions');
    return actor;
  } catch {
    return deny(401, 'Sign in to view analysis');
  }
}
export async function GET(request: NextRequest, context: Context) {
  const actor = await authenticate(request);
  if (actor instanceof Response) return actor;
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return deny(404, 'Analysis not found');
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ))
    return deny(403, 'Analysis access denied');
  if (!(await checkRateLimit(`intelligence:analysis-read:${actor.id}`, 60, 60_000)).allowed)
    return deny(429, 'Too many requests. Try again in a minute.');
  try {
    const analysis = await readIncidentAnalysisState(actor, id.data);
    return analysis ? jsonOk({ analysis }, 200, HEADERS) : deny(404, 'Analysis not found');
  } catch {
    return deny(503, 'Analysis is temporarily unavailable');
  }
}
export async function POST(request: NextRequest, context: Context) {
  const actor = await authenticate(request);
  if (actor instanceof Response) return actor;
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE))
    return deny(403, 'Operator access is required');
  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return deny(404, 'Analysis not found');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return deny(415, 'Send application/json');
  try {
    if (
      !z
        .object({})
        .strict()
        .safeParse(await readJsonBodyWithLimit(request, 256)).success
    )
      return deny(400, 'Invalid request');
  } catch (error) {
    return deny(error instanceof RequestBodyTooLargeError ? 413 : 400, 'Invalid request');
  }
  if (
    !(await checkRateLimit(`intelligence:analysis-request:${actor.id}`, 5, 60_000)).allowed ||
    !(await checkRateLimit(`intelligence:analysis-request:${actor.id}:${id.data}`, 1, 60_000))
      .allowed
  )
    return deny(429, 'Wait before requesting more analysis');
  try {
    const result = await requestIncidentAnalysis(actor, id.data);
    if (result === 'unavailable') return deny(404, 'Analysis not found');
    if (result === 'off') return deny(409, 'Intelligence is off for this service');
    if (result === 'review_required')
      return deny(409, 'Review failed work in operator diagnostics before replaying it');
    return jsonOk({ requested: true }, 202, HEADERS);
  } catch {
    return deny(503, 'Analysis could not be requested');
  }
}

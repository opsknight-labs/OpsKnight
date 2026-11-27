import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { checkRateLimit } from '@/lib/rate-limit';
import { readTextBodyWithLimit, RequestBodyTooLargeError } from '@/lib/request-body';
import {
  applyCatalogImport,
  MAX_IMPORT_BYTES,
  parseCatalog,
} from '@/lib/intelligence/dependencies/import';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };
const deny = (status: number, message: string) => jsonError(message, status, undefined, HEADERS);

/**
 * POST /api/intelligence/topology/import — body is a Backstage catalog (JSON or multi-document YAML).
 * Declares "depends on" edges for entities that match OpsKnight services; reports the rest. Session
 * only, operator capability, rate limited, bounded body.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return deny(403, 'Cross-site requests are not allowed');
  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return deny(401, 'Sign in to import topology');
  }
  if (actor.apiKey || actor.status !== 'ACTIVE')
    return deny(403, 'Import is only available to active app sessions');
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE))
    return deny(403, 'Operator access is required');
  if (!(await checkRateLimit(`intelligence:topology-import:${actor.id}`, 10, 60_000)).allowed)
    return deny(429, 'Too many imports. Try again in a minute.');
  let text: string;
  try {
    // A real byte ceiling while the stream is read: a chunked upload with no Content-Length is cut off too.
    text = await readTextBodyWithLimit(request, MAX_IMPORT_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return deny(413, 'Catalog is larger than 2 MB');
    return deny(400, 'Could not read the request body');
  }
  try {
    const entities = parseCatalog(text);
    const summary = await prisma.$transaction(tx =>
      applyCatalogImport(tx, entities, { actorId: actor.id, source: 'UI' }, 'upload')
    );
    return jsonOk({ summary }, 200, HEADERS);
  } catch (error) {
    if (error instanceof AppError)
      return deny(
        error.code === 'VALIDATION_FAILED' ? 400 : 409,
        error.fields?.[0]?.message ?? error.userMessage
      );
    return deny(503, 'Topology import is temporarily unavailable');
  }
}

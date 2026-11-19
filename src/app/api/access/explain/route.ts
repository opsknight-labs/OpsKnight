import type { NextRequest } from 'next/server';

import { AppError } from '@/lib/errors';
import { jsonApiError, jsonApiOk } from '@/lib/api-response';
import { explainAccessForPath } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

/**
 * Explanation shown on the Access denied page: what the path requires, the caller's own role and
 * teams, and who can grant access. Only describes the signed-in person's access; for denied
 * items it reveals the owning team, never the item's contents.
 */
export async function GET(request: NextRequest) {
  try {
    const path = request.nextUrl.searchParams.get('path') ?? '/';
    const explanation = await explainAccessForPath(path);
    if (!explanation.snapshot) throw new AppError({ code: 'AUTHENTICATION_REQUIRED' });
    return jsonApiOk(explanation, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonApiError(error);
  }
}

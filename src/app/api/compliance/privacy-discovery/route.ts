import type { NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { jsonApiError, jsonApiOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { discoverSubjectData, subjectDiscoveryInputSchema } from '@/lib/privacy/discovery';
import { getUserPermissions } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) {
    return jsonApiError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
  }
  if (!permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE)) {
    return jsonApiError(new AppError({ code: 'AUTHORIZATION_DENIED' }));
  }

  const parsed = subjectDiscoveryInputSchema.safeParse({
    userId: request.nextUrl.searchParams.get('userId'),
    actorUserId: permissions.id,
  });
  if (!parsed.success) {
    return jsonApiError(new AppError({ code: 'VALIDATION_FAILED' }), {
      meta: { issues: parsed.error.flatten().fieldErrors },
    });
  }

  return jsonApiOk(await discoverSubjectData(parsed.data), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

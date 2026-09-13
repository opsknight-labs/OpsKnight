import { NextResponse, type NextRequest } from 'next/server';
import { CAPABILITIES } from '@/lib/authorization';
import { discoverSubjectData, subjectDiscoveryInputSchema } from '@/lib/privacy/discovery';
import { getUserPermissions } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  const permissions = await getUserPermissions();
  if (!permissions.authenticated) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!permissions.capabilities.includes(CAPABILITIES.ADMIN_MANAGE)) {
    return NextResponse.json({ error: 'Administrator access required' }, { status: 403 });
  }

  const parsed = subjectDiscoveryInputSchema.safeParse({
    userId: request.nextUrl.searchParams.get('userId'),
    actorUserId: permissions.id,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'A valid userId is required', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  return NextResponse.json(await discoverSubjectData(parsed.data), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

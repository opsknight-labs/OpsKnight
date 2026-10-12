import 'server-only';
import prisma from '@/lib/prisma';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';

export async function authenticationOrigin() {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { appUrl: true },
  });
  const resolution = resolveAuthPublicOrigin({ dbAppUrl: settings?.appUrl });
  if (resolution.conflicts.length)
    throw new Error(
      'Reconcile conflicting canonical authentication origins before administering authentication.'
    );
  const origin = resolution.origin;
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' &&
    (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('Authentication requires a canonical HTTPS application URL.');
  return origin;
}

export async function assertAuthenticationOrigin(request: Request) {
  const origin = await authenticationOrigin();
  if (request.headers.get('origin') !== origin)
    throw new Error('Authentication request origin rejected.');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    throw new Error('Cross-site authentication request rejected.');
}

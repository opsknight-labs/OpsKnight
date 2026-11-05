import 'server-only';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';
import { recoveryOriginPin } from '@/lib/recovery-origin-pin';

/** A deployment setting an administrator must fix; safe and useful to show them as is. */
export class AuthenticationOriginError extends Error {}

export async function authenticationOrigin(
  tx: Pick<Prisma.TransactionClient, 'systemSettings'> = prisma
) {
  const settings = await tx.systemSettings.findUnique({
    where: { id: 'default' },
    select: { appUrl: true },
  });
  const resolution = resolveAuthPublicOrigin({ dbAppUrl: settings?.appUrl });
  if (resolution.conflicts.length)
    throw new AuthenticationOriginError(
      'OpsKnight is configured with more than one address (NEXTAUTH_URL, NEXT_PUBLIC_APP_URL or the App URL in System settings). Make them identical, then reload this page.'
    );
  const origin = resolution.origin;
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' &&
    (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new AuthenticationOriginError(
      'Single sign-on settings need OpsKnight to run at an HTTPS address. Set NEXTAUTH_URL and the App URL in System settings to your https:// address, then reload this page.'
    );
  return origin;
}

/** Deployment-managed pin. Never derive recovery trust from an incoming Host header. */
export async function recoveryOrigin(
  tx: Pick<Prisma.TransactionClient, 'systemSettings'> = prisma
) {
  const pin = process.env.AUTH_RECOVERY_ORIGIN?.trim();
  if (!pin) return authenticationOrigin(tx);
  const origin = recoveryOriginPin(pin);
  if (!origin)
    throw new Error(
      'AUTH_RECOVERY_ORIGIN must pin an exact HTTPS origin without a path or credentials.'
    );
  return origin;
}

export async function assertAuthenticationOrigin(request: Request, recovery = false) {
  const origin = await (recovery ? recoveryOrigin() : authenticationOrigin());
  if (request.headers.get('origin') !== origin)
    throw new Error('Authentication request origin rejected.');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    throw new Error('Cross-site authentication request rejected.');
}

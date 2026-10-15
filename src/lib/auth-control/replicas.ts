import 'server-only';
import { hostname } from 'node:os';
import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { getLocalAuthPolicy } from '@/lib/local-auth-policy';
import { resolveAuthPublicOrigin } from '@/lib/auth-public-origin';
import { logger } from '@/lib/logger';

export async function observeAuthenticationReplica(id = `${hostname()}:${process.pid}`) {
  const policy = await getAuthenticationPolicy();
  const legacy = getLocalAuthPolicy();
  const snapshot = {
    localLoginEnabled: legacy.localLoginEnabled,
    breakGlassEnabled: legacy.breakGlassEnabled,
    breakGlassEmail: legacy.breakGlassEmail,
  };
  const original = policy.legacySnapshot as Record<string, unknown>;
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { appUrl: true },
  });
  const origin = resolveAuthPublicOrigin({ dbAppUrl: settings?.appUrl });
  const mismatchNames = Object.entries(snapshot)
    .filter(
      ([key, value]) => Object.entries(original).find(([name]) => name === key)?.[1] !== value
    )
    .map(([key]) => key);
  if (origin.conflicts.length) mismatchNames.push('authenticationOrigin');
  const differs = mismatchNames.length > 0;
  await prisma.authenticationReplicaObservation.upsert({
    where: { id },
    create: {
      id,
      snapshot: { ...snapshot, authenticationOrigin: origin.origin, mismatchNames },
      differs,
    },
    update: {
      snapshot: { ...snapshot, authenticationOrigin: origin.origin, mismatchNames },
      differs,
    },
  });
  if (differs)
    logger.warn(
      'Replica legacy authentication settings differ from the one-time import. PostgreSQL policy remains authoritative; reconcile deployment settings.',
      { component: 'authentication-policy', replicaId: id }
    );
  return differs;
}

import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { getCurrentUser } from '@/lib/rbac';
import { isAppRole, roleLabel } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import {
  assertCanReviewMcpConsent,
  expiredConsentReturn,
  supersededMcpGrantsWhere,
} from '@/lib/mcp/auth/consent';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { buildMcpConsentOffer } from '@/lib/mcp/auth/consent-offer';
import { decideMcpConsent } from '@/app/(app)/settings/integrations/mcp/actions';
import { consentIdentity, consentRedirectFacts } from '@/lib/mcp/auth/consent-identity';
import { getUserTimeZone } from '@/lib/timezone';
import ConsentView from './ConsentView';
import './consent.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Connect assistant | OpsKnight',
  referrer: 'no-referrer' as const,
};

export default async function McpConsent({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    redirect('/oauth/mcp/consent/result?code=MCP_CONSENT_EXPIRED');
  let review;
  let who;
  try {
    review = await assertCanReviewMcpConsent(id);
    who = await getCurrentUser();
  } catch (error) {
    if (
      error instanceof AppError &&
      ['AUTHENTICATION_REQUIRED', 'SESSION_REVOKED'].includes(error.code)
    )
      redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/mcp/consent?id=${id}`)}`);
    const code = error instanceof McpBoundaryError ? error.code : 'MCP_UNAVAILABLE';
    if (code === 'MCP_CONSENT_EXPIRED') {
      // Send the person back to their assistant so it can offer a retry, instead of a dead end.
      const back = await expiredConsentReturn(id);
      if (back) redirect(back);
    }
    redirect(`/oauth/mcp/consent/result?code=${encodeURIComponent(code)}`);
  }
  const { request, client } = review;
  if (!isAppRole(who.role)) redirect('/oauth/mcp/consent/result?code=MCP_INACTIVE_PRINCIPAL');
  // decideMcpConsent repeats this on submit: pending request (already within the client ceiling)
  // ∩ what the person's current role can use. Nothing else is ever shown or grantable.
  const [policy, previous] = await Promise.all([
    prisma.mcpPolicy.findUnique({ where: { id: 'default' }, select: { writesEnabled: true } }),
    // The latest live connection for this assistant; its permissions start selected again.
    prisma.mcpGrant.findFirst({
      where: supersededMcpGrantsWhere(who.id, client),
      orderBy: { createdAt: 'desc' },
      select: { scopes: true, createdAt: true },
    }),
  ]);
  const offer = buildMcpConsentOffer({
    scopes: request.scopes,
    explicitlyRequested: request.requestedScopes,
    role: who.role,
    previouslyGranted: previous?.scopes ?? [],
  });
  const returnTo = consentRedirectFacts(request.redirectUri);
  const identity = consentIdentity(client);
  return (
    <ConsentView
      action={decideMcpConsent}
      requestId={request.id}
      clientName={client.name}
      signedInAs={who.email ?? who.name ?? 'you'}
      roleLabel={roleLabel(who.role)}
      groups={offer.groups}
      hasUnavailable={offer.unavailable.length > 0}
      returnHost={returnTo.host}
      identity={identity}
      redirectWarning={identity.kind === 'self-registered' && !returnTo.staysLocal}
      writesEnabled={policy?.writesEnabled ?? false}
      replacesConnectionFrom={previous?.createdAt ?? null}
      timeZone={getUserTimeZone(who)}
    />
  );
}

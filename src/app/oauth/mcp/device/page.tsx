import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { getCurrentUser } from '@/lib/rbac';
import { isAppRole, roleLabel } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import { supersededMcpGrantsWhere } from '@/lib/mcp/auth/consent';
import { buildMcpConsentOffer } from '@/lib/mcp/auth/consent-offer';
import { consentIdentity } from '@/lib/mcp/auth/consent-identity';
import {
  assertCanReviewMcpDevice,
  formatMcpUserCode,
  normalizeMcpUserCode,
} from '@/lib/mcp/auth/device-flow';
import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';
import { mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';
import { getUserTimeZone } from '@/lib/timezone';
import ConsentView from '../consent/ConsentView';
import DeviceView from './DeviceView';
import { confirmMcpDeviceCode, decideMcpDeviceConsent } from './actions';
import '../consent/consent.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Connect a device | OpsKnight',
  referrer: 'no-referrer' as const,
};

const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Only these codes are shown from the address; anything else is ignored. */
const ENTRY_ERRORS = new Set([
  'MCP_DEVICE_CODE_INVALID',
  'MCP_DEVICE_CODE_EXPIRED',
  'MCP_DEVICE_CODE_LOCKED',
  'MCP_RATE_LIMITED',
  'MCP_INVALID_ORIGIN',
]);

/**
 * The device sign-in verification page (RFC 8628 §3.3), outside the app shell like consent. The
 * code from verification_uri_complete is only prefilled: the person still confirms it, then sees
 * the same consent as a browser sign-in with a warning about codes they did not start.
 */
export default async function McpDevice({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string; id?: string; error?: string; done?: string }>;
}) {
  const params = await searchParams;
  const prefill =
    typeof params.user_code === 'string' ? normalizeMcpUserCode(params.user_code) : null;
  let who;
  try {
    who = await getCurrentUser();
  } catch (error) {
    if (
      error instanceof AppError &&
      ['AUTHENTICATION_REQUIRED', 'SESSION_REVOKED'].includes(error.code)
    )
      // Only a well-formed code survives the round trip through sign-in.
      return redirect(
        `/login?callbackUrl=${encodeURIComponent(
          prefill
            ? `/oauth/mcp/device?user_code=${formatMcpUserCode(prefill)}`
            : '/oauth/mcp/device'
        )}`
      );
    throw error;
  }
  if (params.done === 'approved' || params.done === 'denied')
    return <DeviceView state={{ kind: params.done }} action={confirmMcpDeviceCode} />;
  const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
  if (!mcpPolicyInForce(policy) || !policy?.deviceFlowEnabled)
    return (
      <DeviceView
        state={{ kind: 'unavailable', code: 'MCP_DEVICE_FLOW_DISABLED' }}
        action={confirmMcpDeviceCode}
      />
    );
  if (who.status !== 'ACTIVE' || !isAppRole(who.role))
    return (
      <DeviceView
        state={{ kind: 'unavailable', code: 'MCP_INACTIVE_PRINCIPAL' }}
        action={confirmMcpDeviceCode}
      />
    );
  const signedInAs = who.email ?? who.name ?? 'you';
  if (params.id && ID.test(params.id)) {
    // Only this person's own claimed, pending sign-in from a client still allowed the grant.
    const review = await assertCanReviewMcpDevice(params.id, who.id, policy);
    if (!review)
      return (
        <DeviceView
          state={{ kind: 'enter', userCode: '', error: 'MCP_DEVICE_CODE_EXPIRED', signedInAs }}
          action={confirmMcpDeviceCode}
        />
      );
    const { pending, client } = review;
    // decideMcpDeviceConsent repeats this on submit: the stored request ∩ the person's role.
    const previous = await prisma.mcpGrant.findFirst({
      where: supersededMcpGrantsWhere(who.id, client),
      orderBy: { createdAt: 'desc' },
      select: { scopes: true, createdAt: true, _count: { select: { tokens: true } } },
    });
    const offer = buildMcpConsentOffer({
      scopes: pending.scopes,
      explicitlyRequested: pending.requestedScopes,
      role: who.role,
      previouslyGranted: previous?.scopes ?? [],
      readOnly: policy.requireReadOnlyConnections,
    });
    return (
      <ConsentView
        action={decideMcpDeviceConsent}
        requestId={pending.id}
        clientName={client.name}
        signedInAs={signedInAs}
        roleLabel={roleLabel(who.role)}
        groups={offer.groups}
        hasUnavailable={offer.unavailable.length > 0}
        returnHost={null}
        identity={consentIdentity(client, policy)}
        redirectWarning={false}
        writesEnabled={policy.writesEnabled}
        previousConnection={
          previous ? { createdAt: previous.createdAt, inUse: previous._count.tokens > 0 } : null
        }
        timeZone={getUserTimeZone(who)}
        device
      />
    );
  }
  const error =
    params.error && ENTRY_ERRORS.has(params.error) && friendlyMcpError(params.error).known
      ? params.error
      : null;
  return (
    <DeviceView
      state={{
        kind: 'enter',
        userCode: prefill ? formatMcpUserCode(prefill) : '',
        error,
        signedInAs,
      }}
      action={confirmMcpDeviceCode}
    />
  );
}

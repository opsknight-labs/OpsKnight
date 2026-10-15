'use client';

import { ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';
import AuthenticationAdminPicker from '../AuthenticationAdminPicker';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { AuthenticationVerificationSummary } from './AuthenticationVerificationStatus';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';

type LinkRequirement = 'not-needed' | 'required' | 'unknown';

/**
 * One administrator sign-in test for both the Identity Provider and Sessions & Policies tabs, so
 * status, consent and blockers can never disagree between the two entry points.
 *
 * Linking consent is always an explicit, per-test choice. A previous successful test never
 * implies consent for the next one.
 */
export default function AuthenticationAdminTestPanel() {
  const {
    data,
    revisionId,
    adminId,
    setAdminId,
    linkApproved,
    setLinkApproved,
    draftDirty,
    pending,
    perform,
    setActiveTab,
  } = useAuthenticationWorkspace();
  const revision = data.revisions.find(item => item.id === revisionId);
  const admin = data.users.find(user => user.id === adminId);
  const adminLabel = admin ? admin.name || admin.email : 'the selected administrator';

  // A binding exists when this administrator already has an identity under the issuer being
  // tested and the client registration is unchanged (Entra subjects are per registration).
  const linkRequirement: LinkRequirement = (() => {
    if (!revision || !admin) return 'unknown';
    const issuer = normalizeOidcIssuer(revision.configuration.issuer);
    const hasIssuerIdentity = admin.issuers.some(value => normalizeOidcIssuer(value) === issuer);
    const registrationChanged = Boolean(
      data.activeProvider &&
      normalizeOidcIssuer(data.activeProvider.issuer) === issuer &&
      data.activeProvider.clientId !== revision.configuration.clientId
    );
    return hasIssuerIdentity && !registrationChanged ? 'not-needed' : 'required';
  })();

  const isRetest =
    revision?.verification.state !== undefined && revision.verification.state !== 'required';
  const availability = actionAvailability(
    isRetest ? 'Retest sign-in' : 'Test administrator sign-in',
    [
      pending && { code: 'busy', message: 'Wait for the current operation to finish.' },
      draftDirty && {
        code: 'draft',
        message: 'Stage your draft changes before testing sign-in.',
        resolutionTarget: 'connection',
        resolutionLabel: 'Review draft',
      },
      !revision && {
        code: 'revision',
        message: 'Select a saved configuration, or stage the current draft.',
        resolutionTarget: 'connection',
        resolutionLabel: 'Open Identity Provider',
      },
      Boolean(
        revision &&
        revision.id !== data.activeRevisionId &&
        revision.baseConfigVersion !== data.providerConfigVersion
      ) && {
        code: 'stale',
        message:
          'The active provider changed after this configuration was saved. Stage a current draft.',
        resolutionTarget: 'connection',
        resolutionLabel: 'Review in Connection',
      },
      !adminId && { code: 'admin', message: 'Choose the administrator to verify.' },
      data.freshAuthenticationRequired && {
        code: 'fresh',
        message:
          data.actor.kind === 'admin'
            ? 'Your last sign-in was more than two hours ago. Sign in again to continue.'
            : 'Verify your recovery credential again to continue.',
      },
      linkRequirement === 'required' &&
        !linkApproved && {
          code: 'consent',
          message: `${adminLabel} has no identity for this provider yet. Allow linking below to test.`,
        },
    ]
  );

  return (
    <div className="space-y-4">
      {revision && <AuthenticationVerificationSummary verification={revision.verification} />}

      <AuthenticationAdminPicker
        label="Administrator to verify"
        value={adminId}
        onChange={id => {
          setAdminId(id);
          setLinkApproved(false);
        }}
        initialAdmins={data.users.filter(user => user.role === 'ADMIN' && user.status === 'ACTIVE')}
        disabled={data.actor.kind === 'admin'}
      />

      {linkRequirement === 'not-needed' ? (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {adminLabel} already has an identity for this provider. The test signs in with that
            existing link; no new account link is created.
          </span>
        </p>
      ) : (
        <label className="flex items-start gap-2.5 rounded-lg border bg-muted/20 p-3.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
            checked={linkApproved}
            disabled={pending}
            aria-describedby="auth-link-consent-help"
            onChange={event => setLinkApproved(event.target.checked)}
          />
          <span className="min-w-0 space-y-1">
            <span className="block text-xs font-medium text-foreground leading-relaxed">
              Allow this SSO identity to link to the selected existing OpsKnight administrator
              {admin ? ` (${admin.email})` : ''}.
            </span>
            <span
              id="auth-link-consent-help"
              className="block text-xs text-muted-foreground leading-relaxed"
            >
              The link is created only after a successful sign-in at the identity provider with a
              verified email that matches this account, and only when SSO is activated. Matching
              emails alone never link an account.
              {linkRequirement === 'required' ? ' Required for this test.' : ''}
            </span>
          </span>
        </label>
      )}

      <AuthenticationActionGuard availability={availability} onResolve={setActiveTab}>
        <Button
          className="gap-2"
          variant={isRetest && revision?.verification.state === 'valid' ? 'outline' : 'default'}
          onClick={() =>
            void perform(async () => {
              const result = await authenticationRequest<{ url: string }>({
                action: 'test',
                revisionId,
                adminUserId: adminId,
                // Consent is exactly what the administrator selected for this test.
                linkApproved: linkRequirement !== 'not-needed' && linkApproved,
              });
              window.location.assign(result.url);
            })
          }
        >
          {isRetest ? (
            <RefreshCw className="h-4 w-4" aria-hidden />
          ) : (
            <ExternalLink className="h-4 w-4" aria-hidden />
          )}
          {isRetest ? 'Retest administrator sign-in' : 'Test administrator sign-in'}
        </Button>
      </AuthenticationActionGuard>
    </div>
  );
}

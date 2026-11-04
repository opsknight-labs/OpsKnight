'use client';

import { AlertTriangle, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';
import AuthenticationAdminPicker from '../AuthenticationAdminPicker';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { AuthenticationVerificationSummary } from './AuthenticationVerificationStatus';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';

type LinkRequirement = 'not-needed' | 'required' | 'unknown';

/**
 * One administrator sign-in test for both the Connect provider and Test & activate steps, so
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
    stageDraft,
    configuration,
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

  // Predictable failures, said before the administrator leaves for the identity provider.
  const preflight: string[] = (() => {
    if (!admin) return [];
    // The draft is what will be tested: it is saved first when it has changes.
    const config = configuration;
    const warnings: string[] = [];
    const domain = admin.email.split('@')[1]?.toLowerCase() ?? '';
    if (linkRequirement === 'required') {
      if (!domain.includes('.') || domain === 'localhost')
        warnings.push(
          `${admin.email} is not a real mailbox. The identity provider must send exactly this email, so change your OpsKnight email in Profile to your work address first.`
        );
      else
        warnings.push(
          `Sign in at the identity provider as ${admin.email}. The verified email must match exactly.`
        );
      if (
        config.providerType !== 'azure' &&
        config.allowedDomains.length > 0 &&
        !config.allowedDomains.includes(domain)
      )
        warnings.push(
          `${domain} is not in the allowed domains (${config.allowedDomains.join(', ')}). Add it under Who can sign in, or the test will fail.`
        );
      if (config.providerType === 'azure')
        warnings.push(
          'Microsoft Entra sends the email only when the optional "email" claim is added in App registration → Token configuration.'
        );
    }
    if (config.roleMapping.length > 0 && !config.roleMapping.some(rule => rule.role === 'ADMIN'))
      warnings.push(
        'No role rule grants Administrator. If your role is managed by single sign-on, the test will fail to protect your access.'
      );
    return warnings;
  })();

  const isRetest =
    revision?.verification.state !== undefined && revision.verification.state !== 'required';
  const availability = actionAvailability(
    isRetest ? 'Retest sign-in' : 'Test administrator sign-in',
    [
      pending && { code: 'busy', message: 'Wait for the current operation to finish.' },
      !draftDirty &&
        !revision && {
          code: 'revision',
          message: 'Save your provider connection first.',
          resolutionTarget: 'connection',
          resolutionLabel: 'Go to Connect provider',
        },
      Boolean(
        !draftDirty &&
        revision &&
        revision.id !== data.activeRevisionId &&
        revision.baseConfigVersion !== data.providerConfigVersion
      ) && {
        code: 'stale',
        message:
          'The active provider changed after this configuration was saved. Save your changes again.',
        resolutionTarget: 'connection',
        resolutionLabel: 'Review in Connect provider',
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

      {preflight.length > 0 && (
        <div
          role="note"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed"
        >
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
            Before you test
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {preflight.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <AuthenticationActionGuard availability={availability} onResolve={setActiveTab}>
        <Button
          className="gap-2"
          variant={isRetest && revision?.verification.state === 'valid' ? 'outline' : 'default'}
          onClick={async () => {
            // Unsaved changes are saved first, so testing is one step, not two.
            const testedRevisionId = draftDirty ? await stageDraft() : revisionId;
            if (!testedRevisionId) return;
            void perform(async () => {
              const result = await authenticationRequest<{ url: string }>({
                action: 'test',
                revisionId: testedRevisionId,
                adminUserId: adminId,
                // Consent is exactly what the administrator selected for this test.
                linkApproved: linkRequirement !== 'not-needed' && linkApproved,
              });
              window.location.assign(result.url);
            });
          }}
        >
          {isRetest ? (
            <RefreshCw className="h-4 w-4" aria-hidden />
          ) : (
            <ExternalLink className="h-4 w-4" aria-hidden />
          )}
          {draftDirty
            ? 'Save and test sign-in'
            : isRetest
              ? 'Test sign-in again'
              : 'Test my sign-in'}
        </Button>
      </AuthenticationActionGuard>
    </div>
  );
}

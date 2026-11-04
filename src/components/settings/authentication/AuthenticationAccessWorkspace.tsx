'use client';
import { useState } from 'react';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import AuthenticationUserDirectory from '../AuthenticationUserDirectory';
import HelpHint from './HelpHint';
import { authDocs } from './setup-steps';
import {
  approveOidcLinkingBulk,
  dismissOidcLinkingRequest,
  previewOidcLinkingBulk,
} from '@/app/(app)/users/oidc-actions';
import { Users, UserCheck, Inbox, ShieldCheck } from 'lucide-react';

type BulkPreview = {
  count: number;
  sample: Array<{ id: string; name: string | null; email: string }>;
};

/** Per provider, what actually limits who can sign in. */
function boundaryExplanation(providerType: string) {
  switch (providerType) {
    case 'azure':
      return 'Microsoft Entra limits sign-in to your tenant automatically, so allowed domains are not used to block sign-in. Use them for domain-trusted linking below.';
    case 'google':
      return 'Google Workspace is checked with the signed hosted-domain (hd) claim, so only accounts in these Workspace domains can sign in.';
    case 'auth0':
      return 'Only verified emails in these domains can sign in. Set the Auth0 organization in Connect provider to restrict by organization as well.';
    default:
      return 'Only people whose provider reports a verified email in these domains can sign in. Leave empty to rely on who is assigned to the app in your provider.';
  }
}

export default function AuthenticationAccessWorkspace() {
  const {
    data,
    configuration,
    domainText,
    setDomainText,
    revisionId,
    fieldErrors,
    pending,
    perform,
    update,
    setMessage,
    refresh,
    inputClass,
    sectionClass,
    scimSection,
  } = useAuthenticationWorkspace();
  const [scope, setScope] = useState<'domain' | 'all'>(
    configuration.allowedDomains.length ? 'domain' : 'all'
  );
  const [expiryDays, setExpiryDays] = useState(14);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const isEntra = configuration.providerType === 'azure';
  const bulkInput = {
    scope,
    ...(scope === 'domain' ? { domains: configuration.allowedDomains } : {}),
    ...(revisionId ? { revisionId } : {}),
    expiryDays,
  } as const;

  return (
    <section className={sectionClass} aria-labelledby="auth-access-title">
      <header className="space-y-1 border-b pb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Users className="h-4 w-4" />
          </div>
          <h2 id="auth-access-title" className="text-base font-bold text-foreground sm:text-lg">
            Who can sign in
          </h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Decide who gets a new account on first sign-in, and how people who already have an
          OpsKnight account connect it to single sign-on.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
        <h3 className="text-sm font-semibold text-foreground">New people</h3>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            disabled={pending}
            checked={configuration.autoProvision}
            onChange={event => update('autoProvision', event.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="block font-medium">Create an account on first sign-in</span>
            <span className="block text-xs text-muted-foreground">
              Anyone your identity provider lets sign in to OpsKnight gets an account with the role
              from Roles &amp; teams. Turn off to allow only people you invite.
            </span>
          </span>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
            Allowed email domains
            <HelpHint label="About allowed domains" href={authDocs.configure}>
              {boundaryExplanation(configuration.providerType)}
            </HelpHint>
          </span>
          <input
            className={inputClass}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.allowedDomains)}
            aria-describedby="auth-domains-help"
            id="auth-field-allowedDomains"
            value={domainText}
            placeholder="example.com, subsidiary.example"
            onChange={event => {
              update(
                'allowedDomains',
                event.target.value
                  .split(',')
                  .map(value => value.trim().toLowerCase())
                  .filter(Boolean)
              );
              setDomainText(event.target.value);
              setPreview(null);
            }}
          />
          <span
            id="auth-domains-help"
            className="block text-xs leading-relaxed text-muted-foreground"
          >
            {fieldErrors.allowedDomains ?? boundaryExplanation(configuration.providerType)}
          </span>
        </label>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            People who already have an account
          </h3>
          <HelpHint label="About linking existing accounts" href={authDocs.linking}>
            An existing account connects to single sign-on on its first SSO sign-in. Matching email
            alone never connects an account: either you approve it, or you trust your verified
            company domain.
          </HelpHint>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            disabled={pending || configuration.allowedDomains.length === 0}
            checked={configuration.domainTrustedLinking}
            onChange={event => update('domainTrustedLinking', event.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              Connect accounts automatically for verified company emails
              <Badge variant="outline" className="text-[10px]">
                Recommended
              </Badge>
            </span>
            <span className="block text-xs text-muted-foreground">
              {configuration.allowedDomains.length === 0
                ? 'Add an allowed domain first.'
                : `By turning this on you confirm every verified @${configuration.allowedDomains.join(', @')} mailbox belongs to someone your company controls. Those people connect on first sign-in without approval. Administrators always need your approval.${isEntra ? ' Microsoft Entra must also send the xms_edov claim: add it as an optional ID token claim.' : ''}`}
            </span>
          </span>
        </label>

        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <UserCheck className="h-3.5 w-3.5" />
            Approve existing accounts in bulk
          </p>
          <p className="text-xs text-muted-foreground">
            Prepares everyone so their first SSO sign-in just works. You can do this before turning
            SSO on. Each approval is for this provider and the person&apos;s own email, and is used
            once.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-medium">
              Who
              <select
                className={inputClass}
                value={scope}
                disabled={pending}
                onChange={event => {
                  setScope(event.target.value as 'domain' | 'all');
                  setPreview(null);
                }}
              >
                {configuration.allowedDomains.length > 0 && (
                  <option value="domain">Everyone in the allowed domains</option>
                )}
                <option value="all">Everyone</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium">
              Approval lasts
              <select
                className={inputClass}
                value={expiryDays}
                disabled={pending}
                onChange={event => setExpiryDays(Number(event.target.value))}
              >
                {[7, 14, 30].map(days => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || (!revisionId && !data.activeProvider)}
              onClick={() =>
                void perform(async () => {
                  const result = await previewOidcLinkingBulk(bulkInput);
                  if ('error' in result && result.error) throw new Error(result.error);
                  setPreview(result as BulkPreview);
                })
              }
            >
              Preview
            </Button>
          </div>
          {!revisionId && !data.activeProvider && (
            <p className="text-xs text-muted-foreground">Save your provider connection first.</p>
          )}
          {preview && (
            <div className="space-y-2 text-xs" role="status">
              {preview.count === 0 ? (
                <p>Everyone in this group is already connected or approved.</p>
              ) : (
                <>
                  <p>
                    <strong>{preview.count}</strong> {preview.count === 1 ? 'person' : 'people'}{' '}
                    will be approved
                    {preview.sample.length > 0 &&
                      `, including ${preview.sample
                        .slice(0, 5)
                        .map(person => person.name || person.email)
                        .join(', ')}`}
                    . Administrators are not included; approve them one by one below.
                  </p>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        const result = await approveOidcLinkingBulk(bulkInput);
                        if ('error' in result && result.error) throw new Error(result.error);
                        setPreview(null);
                        await refresh();
                        setMessage(
                          `Approved ${'approved' in result ? result.approved : 0} people for ${expiryDays} days.${
                            'remaining' in result && result.remaining
                              ? ` ${result.remaining} more remain; run it again to continue.`
                              : ''
                          }`
                        );
                      })
                    }
                  >
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Approve {preview.count} {preview.count === 1 ? 'person' : 'people'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {data.linkingRequests.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-xs sm:p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Inbox className="h-4 w-4" />
            Waiting for your approval ({data.linkingRequestCount})
          </h3>
          <ul className="divide-y rounded-lg border bg-card">
            {data.linkingRequests.map(request => (
              <li
                key={request.userId}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">
                    {request.name || request.email}
                    {request.role === 'ADMIN' && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Administrator
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {request.email} · tried {request.attempts}{' '}
                    {request.attempts === 1 ? 'time' : 'times'}
                    {request.reason === 'OIDC_LINK_APPROVAL_EXPIRED' ? ' · approval expired' : ''}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        const result = await approveOidcLinkingBulk({
                          scope: 'selected',
                          userIds: [request.userId],
                          ...(revisionId ? { revisionId } : {}),
                          expiryDays,
                        });
                        if ('error' in result && result.error) throw new Error(result.error);
                        await refresh();
                        setMessage(`${request.name || request.email} can now sign in with SSO.`);
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        await dismissOidcLinkingRequest(request.userId);
                        await refresh();
                      })
                    }
                  >
                    Dismiss
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.actor.kind === 'admin' && <AuthenticationUserDirectory />}

      {/* Read-only SCIM status; the dedicated SCIM section is the single place to edit it. */}
      {scimSection}
    </section>
  );
}

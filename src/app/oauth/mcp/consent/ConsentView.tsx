import { MCP_ABSOLUTE_SESSION_DAYS } from '@/lib/mcp/auth/session-lifetime';
import AuthBrand from '@/components/auth/AuthBrand';
import { AlertTriangle, BadgeCheck, Info, ShieldAlert } from 'lucide-react';
import type { McpConsentGroup } from '@/lib/mcp/auth/consent-offer';
import type { McpConsentIdentity } from '@/lib/mcp/auth/consent-identity';
import ConsentForm from './ConsentForm';
import { MCP_CONSENT_WRITES_OFF_NOTE } from '@/lib/mcp/policy-copy';
import { AssistantIcon } from '@/components/common/BrandLogos';
import { formatDateTime } from '@/lib/timezone';
import { mcpHref } from '@/app/(app)/settings/integrations/mcp/list-params';

type Props = {
  action: (form: FormData) => Promise<void>;
  requestId: string;
  clientName: string;
  /** Email or name of the signed-in person. */
  signedInAs: string;
  /** Display label of the person's role, e.g. "Responder". */
  roleLabel: string;
  groups: McpConsentGroup[];
  hasUnavailable: boolean;
  /** Where the browser returns after a decision; null for a device sign-in, which has none. */
  returnHost: string | null;
  /** The full address the browser returns to (no query), shown so the user can check it. */
  returnAddress?: string | null;
  /** Days without use after which the connection ends; shown with the fixed overall limit. */
  idleDays?: number;
  /** How OpsKnight knows who this assistant is. */
  identity: McpConsentIdentity;
  /**
   * The browser returns to a web address the assistant's identity does not vouch for: any web
   * address for a self-registered client, another site for a metadata-document client.
   */
  redirectWarning: boolean;
  /** False while an administrator has turned changes off. */
  writesEnabled: boolean;
  /**
   * The person's latest live connection for this assistant. Allowing replaces it only while it
   * was never used (an unfinished sign-in); one in use stays signed in.
   */
  previousConnection: { createdAt: Date; inUse: boolean } | null;
  /** The signed-in person's time zone, for every time shown here. */
  timeZone: string;
  /**
   * A device sign-in (RFC 8628): the tokens go to another device, not this browser, so the
   * person is warned to continue only for a sign-in they started on a device they control.
   */
  device?: boolean;
};

/** The phishing warning of a device sign-in (RFC 8628 §5.4). */
export const MCP_DEVICE_CONSENT_WARNING =
  'Only continue if you started this sign-in yourself on a device you control.';

/** The focused consent dialog. Pure presentation: the page loads and authorizes the data. */
export default function ConsentView({
  action,
  requestId,
  clientName,
  signedInAs,
  roleLabel,
  groups,
  hasUnavailable,
  returnHost,
  returnAddress = null,
  idleDays,
  identity,
  redirectWarning,
  writesEnabled,
  previousConnection,
  timeZone,
  device = false,
}: Props) {
  const hasChanges = groups.some(group => group.change.length > 0);
  // Shown in the person's own time zone, named, so an unfamiliar time is not misread.
  const connectedAt = (value: Date) => formatDateTime(value, timeZone, { includeTimeZone: true });
  // Many areas get a two-column grid on large screens; a short list stays a compact dialog.
  const wide =
    groups.length > 2 && groups.reduce((n, g) => n + g.view.length + g.change.length, 0) > 8;
  return (
    <main
      id="mcp-consent"
      className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 font-sans text-slate-900 sm:px-6 sm:py-12 dark:bg-slate-950 dark:text-slate-100"
    >
      <div
        className={
          wide
            ? 'w-full max-w-xl space-y-6 lg:max-w-[860px] min-[1440px]:max-w-[1080px] min-[1920px]:max-w-[1180px]'
            : 'w-full max-w-xl space-y-6 min-[1440px]:max-w-2xl'
        }
      >
        <AuthBrand />
        <section
          aria-labelledby="mcp-consent-title"
          className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 min-[1440px]:p-9 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="space-y-1.5">
            <h1
              id="mcp-consent-title"
              className="flex items-center gap-2 break-words font-display font-bold tracking-tight text-slate-950 dark:text-white"
            >
              {/* A brand logo only for a metadata host an administrator trusts (SEC-6); a chosen
                  name, or an untrusted publisher, gets the generic icon. */}
              <AssistantIcon
                name={clientName}
                verifiedHost={
                  identity.kind === 'metadata' && identity.trusted ? identity.host : null
                }
                className="h-6 w-6 shrink-0"
              />
              <span className="min-w-0">Connect {clientName}?</span>
            </h1>
            <p
              data-testid="mcp-consent-identity"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
            >
              {returnHost !== null ? (
                <span>
                  Returns to{' '}
                  <code className="rounded bg-slate-100 px-1 py-px font-mono text-[12px] [overflow-wrap:anywhere] text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                    {returnAddress ?? returnHost}
                  </code>
                </span>
              ) : (
                <span>Signs in another device</span>
              )}
              {identity.kind === 'metadata' && identity.trusted ? (
                // Only a host an administrator trusts earns the verified look.
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Identified by{' '}
                  <code className="font-mono [overflow-wrap:anywhere]">{identity.host}</code>
                </span>
              ) : identity.kind === 'metadata' ? (
                <span className="text-slate-600 dark:text-slate-300">
                  Published by{' '}
                  <code className="font-mono [overflow-wrap:anywhere] text-slate-900 dark:text-slate-100">
                    {identity.host}
                  </code>
                </span>
              ) : identity.kind === 'self-registered' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                  Name not verified
                </span>
              ) : (
                <span>Registered by an administrator</span>
              )}
            </p>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Signed in as{' '}
              <strong className="font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-white">
                {signedInAs}
              </strong>{' '}
              ({roleLabel}). The assistant acts as you and can only use the permissions you allow
              here, within what your role already permits.
            </p>
          </div>
          {device && (
            <div
              role="note"
              data-testid="mcp-device-warning"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">{MCP_DEVICE_CONSENT_WARNING}</strong> Someone who
                sent you this code or link could otherwise get access as you. If you did not start
                it, choose Cancel.
              </span>
            </div>
          )}
          {redirectWarning && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {identity.kind === 'metadata' ? (
                <span>
                  This assistant is published by{' '}
                  <strong className="[overflow-wrap:anywhere]">{identity.host}</strong> but sends
                  you to <strong className="[overflow-wrap:anywhere]">{returnHost}</strong>. Only
                  continue if you just started this connection yourself and recognise both.
                </span>
              ) : (
                <span>
                  This assistant named itself and sends you to the website{' '}
                  <strong className="[overflow-wrap:anywhere]">{returnHost}</strong>. Only continue
                  if you just started this connection yourself and recognise that address.
                </span>
              )}
            </div>
          )}
          {!writesEnabled && hasChanges && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{MCP_CONSENT_WRITES_OFF_NOTE}</span>
            </div>
          )}
          {idleDays !== undefined && (
            <p
              data-testid="mcp-consent-duration"
              className="text-xs text-slate-500 dark:text-slate-400"
            >
              Stays connected until you disconnect it in Settings, it goes unused for {idleDays}{' '}
              {idleDays === 1 ? 'day' : 'days'}, or {MCP_ABSOLUTE_SESSION_DAYS} days pass.
            </p>
          )}
          {previousConnection && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {previousConnection.inUse ? (
                <>
                  Your existing connection from{' '}
                  <time dateTime={previousConnection.createdAt.toISOString()}>
                    {connectedAt(previousConnection.createdAt)}
                  </time>{' '}
                  stays signed in; you can sign it out under Settings → Integrations & ChatOps → MCP
                  (AI Assistants). Permissions marked New are what this adds.
                </>
              ) : (
                <>
                  Allowing replaces your unfinished sign-in from{' '}
                  <time dateTime={previousConnection.createdAt.toISOString()}>
                    {connectedAt(previousConnection.createdAt)}
                  </time>
                  .
                </>
              )}
            </p>
          )}
          <ConsentForm
            action={action}
            requestId={requestId}
            clientName={clientName}
            groups={groups}
            unavailableNote={
              hasUnavailable
                ? `Some requested permissions aren’t available to your role (${roleLabel}).`
                : null
            }
            wide={wide}
            writesEnabled={writesEnabled}
          />
          <p className="border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            You can{' '}
            <a
              href={mcpHref({ tab: 'connections' })}
              className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
            >
              disconnect any time
            </a>{' '}
            in Settings → Integrations & ChatOps → MCP (AI Assistants).
            {identity.kind === 'self-registered' && !redirectWarning && (
              <> Only continue if you just started this connection yourself.</>
            )}
            {identity.kind === 'metadata' && !identity.trusted && (
              <>
                {' '}
                The name {clientName} was published by {identity.host}; your administrator has not
                listed that site as trusted.
              </>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}

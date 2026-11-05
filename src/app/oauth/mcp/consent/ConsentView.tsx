import Image from 'next/image';
import { AlertTriangle, BadgeCheck, Info } from 'lucide-react';
import type { McpConsentGroup } from '@/lib/mcp/auth/consent-offer';
import type { McpConsentIdentity } from '@/lib/mcp/auth/consent-identity';
import ConsentForm from './ConsentForm';

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
  /** Where the browser returns after a decision. */
  returnHost: string;
  /** How OpsKnight knows who this assistant is. */
  identity: McpConsentIdentity;
  /** A self-registered client returns to a non-loopback web address. */
  redirectWarning: boolean;
  /** False while an administrator has turned changes off. */
  writesEnabled: boolean;
  /** When the connection this consent replaces was created, if there is one. */
  replacesConnectionFrom: Date | null;
};

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
  identity,
  redirectWarning,
  writesEnabled,
  replacesConnectionFrom,
}: Props) {
  const hasChanges = groups.some(group => group.change.length > 0);
  // Many areas get a two-column grid on large screens; a short list stays a compact dialog.
  const wide =
    groups.length > 2 && groups.reduce((n, g) => n + g.view.length + g.change.length, 0) > 8;
  return (
    <main
      id="mcp-consent"
      className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 font-['Inter',ui-sans-serif,system-ui,sans-serif] text-slate-900 sm:px-6 sm:py-12 dark:bg-slate-950 dark:text-slate-100"
    >
      <div
        className={
          wide
            ? 'w-full max-w-xl space-y-6 lg:max-w-[860px] min-[1440px]:max-w-[1080px] min-[1920px]:max-w-[1180px]'
            : 'w-full max-w-xl space-y-6 min-[1440px]:max-w-2xl'
        }
      >
        <a
          href="https://opsknight.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="OpsKnight official website"
          className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:focus-visible:ring-white"
        >
          <Image
            src="/logo.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain min-[1440px]:h-9 min-[1440px]:w-9"
            priority
            unoptimized
          />
          <span className="font-['Space_Grotesk',sans-serif] text-lg font-bold tracking-tight">
            OpsKnight
          </span>
        </a>
        <section
          aria-labelledby="mcp-consent-title"
          className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 min-[1440px]:p-9 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="space-y-1.5">
            <h1
              id="mcp-consent-title"
              className="break-words font-['Space_Grotesk',sans-serif] font-bold tracking-tight text-slate-950 dark:text-white"
            >
              Connect {clientName}?
            </h1>
            <p
              data-testid="mcp-consent-identity"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
            >
              <span>
                Returns to{' '}
                <code className="rounded bg-slate-100 px-1 py-px font-mono text-[12px] [overflow-wrap:anywhere] text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                  {returnHost}
                </code>
              </span>
              {identity.kind === 'metadata' ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Identified by{' '}
                  <code className="font-mono [overflow-wrap:anywhere]">{identity.host}</code>
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
          {redirectWarning && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                This assistant named itself and sends you to the website{' '}
                <strong className="[overflow-wrap:anywhere]">{returnHost}</strong>. Only continue if
                you just started this connection yourself and recognise that address.
              </span>
            </div>
          )}
          {!writesEnabled && hasChanges && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Changes are currently turned off by your administrator. Change permissions take
                effect only if changes are turned on, and each change still needs approval.
              </span>
            </div>
          )}
          {replacesConnectionFrom && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Allowing replaces your connection from{' '}
              {replacesConnectionFrom.toLocaleDateString('en-US', {
                dateStyle: 'medium',
                timeZone: 'UTC',
              })}
              .
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
            You can disconnect any time in Settings → Integrations & ChatOps → MCP (AI Assistants).
            {identity.kind === 'self-registered' && !redirectWarning && (
              <> Only continue if you just started this connection yourself.</>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}

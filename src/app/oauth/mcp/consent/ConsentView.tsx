import Image from 'next/image';
import type { McpConsentGroup } from '@/lib/mcp/auth/consent-offer';
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
  /** Set for self-registered clients: where the browser returns after a decision. */
  returnHost: string | null;
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
}: Props) {
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
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Signed in as{' '}
              <strong className="font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-white">
                {signedInAs}
              </strong>{' '}
              ({roleLabel}). The assistant acts as you and can only use the permissions you allow
              here, within what your role already permits.
            </p>
          </div>
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
          />
          <p className="border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            You can disconnect any time in Settings → Integrations & ChatOps → MCP (AI Assistants).
            {returnHost !== null && (
              <>
                {' '}
                Only continue if you just started this connection yourself
                {returnHost ? <> (it will return to {returnHost})</> : null}.
              </>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}

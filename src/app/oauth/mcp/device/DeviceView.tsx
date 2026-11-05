import Image from 'next/image';
import type { ReactNode } from 'react';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';
import { MCP_DOCS_LINKS } from '@/lib/mcp/docs-links';
import { mcpHref } from '@/app/(app)/settings/integrations/mcp/list-params';
import { MCP_DEVICE_CONSENT_WARNING } from '../consent/ConsentView';

export type McpDeviceViewState =
  /** Type or confirm the code shown on the device. `error` is a known code from the last try. */
  | { kind: 'enter'; userCode: string; error: string | null; signedInAs: string }
  | { kind: 'approved' }
  | { kind: 'denied' }
  /** Device sign-in cannot be used at all (turned off, inactive account). */
  | { kind: 'unavailable'; code: string };

type Props = {
  state: McpDeviceViewState;
  /** Confirms the code; never called for a prefilled code until the person clicks Continue. */
  action: (form: FormData) => Promise<void>;
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <main
      id="mcp-consent"
      className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 font-sans text-slate-900 sm:px-6 sm:py-12 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="w-full max-w-md space-y-6 min-[1440px]:max-w-lg">
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
            className="h-8 w-8 object-contain"
            priority
            unoptimized
          />
          <span className="font-display text-lg font-bold tracking-tight">OpsKnight</span>
        </a>
        <section
          aria-labelledby="mcp-device-title"
          className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 dark:border-slate-800 dark:bg-slate-900"
        >
          {children}
        </section>
      </div>
    </main>
  );
}

const titleClass =
  'flex items-center gap-2 font-display font-bold tracking-tight text-slate-950 dark:text-white';

/** The device sign-in page outside the consent step. Pure presentation. */
export default function DeviceView({ state, action }: Props) {
  if (state.kind === 'approved' || state.kind === 'denied') {
    const approved = state.kind === 'approved';
    return (
      <Shell>
        <h1 id="mcp-device-title" className={titleClass}>
          {approved ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
          ) : (
            <XCircle className="h-6 w-6 text-slate-500" aria-hidden="true" />
          )}
          {approved ? 'Device connected' : 'Sign-in cancelled'}
        </h1>
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          {approved
            ? 'Return to your device; it finishes signing in within a few seconds. You can close this page.'
            : 'Nothing was connected. You can close this page.'}
        </p>
        {approved && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            You can{' '}
            <a
              href={mcpHref({ tab: 'connections' })}
              className="font-medium text-slate-700 underline underline-offset-2 dark:text-slate-200"
            >
              disconnect it any time
            </a>{' '}
            in Settings → Integrations & ChatOps → MCP (AI Assistants).
          </p>
        )}
      </Shell>
    );
  }
  if (state.kind === 'unavailable') {
    const { title, body } = friendlyMcpError(state.code);
    return (
      <Shell>
        <h1 id="mcp-device-title" className={titleClass}>
          {title}
        </h1>
        <p role="alert" className="text-sm text-slate-600 dark:text-slate-300">
          {body}
        </p>
        <a
          href={MCP_DOCS_LINKS.troubleshooting}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium underline underline-offset-2"
        >
          Troubleshooting guide
        </a>
      </Shell>
    );
  }
  const problem = state.error ? friendlyMcpError(state.error) : null;
  const prefilled = state.userCode !== '';
  return (
    <Shell>
      <div className="space-y-1.5">
        <h1 id="mcp-device-title" className={titleClass}>
          Connect a device
        </h1>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Signed in as{' '}
          <strong className="font-semibold [overflow-wrap:anywhere] text-slate-900 dark:text-white">
            {state.signedInAs}
          </strong>
          .{' '}
          {prefilled
            ? 'Check that this code matches the one shown on your device, then choose Continue.'
            : 'Enter the code shown on your device.'}
        </p>
      </div>
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{MCP_DEVICE_CONSENT_WARNING} Never enter a code someone else sent you.</span>
      </div>
      {problem && (
        <p
          role="alert"
          data-testid="mcp-device-error"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-200"
        >
          <strong className="font-semibold">{problem.title}.</strong> {problem.body}
        </p>
      )}
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="mcp-device-code"
            className="text-sm font-medium text-slate-900 dark:text-slate-100"
          >
            Code
          </label>
          <input
            id="mcp-device-code"
            name="user_code"
            defaultValue={state.userCode}
            required
            maxLength={16}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="BCDF-GHJK"
            aria-describedby="mcp-device-code-help"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center font-mono text-xl uppercase tracking-[0.3em] text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus-visible:ring-white"
          />
          <p id="mcp-device-code-help" className="text-xs text-slate-500 dark:text-slate-400">
            Eight letters; capitals and the dash are optional.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-5 font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            Continue
          </button>
        </div>
      </form>
    </Shell>
  );
}

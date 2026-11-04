import Image from 'next/image';
import Link from 'next/link';
import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';
import { MCP_DOCS_LINKS } from '@/lib/mcp/docs-links';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Assistant connection | OpsKnight',
  referrer: 'no-referrer' as const,
};

/** Where a consent decision that could not complete lands; the same branded shell as consent. */
export default async function McpConsentResult({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code = '' } = await searchParams;
  const { title, body, known } = friendlyMcpError(code.slice(0, 64));
  // Only a known code is echoed as a reference, never arbitrary query text.
  const reference = known ? code : null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 font-['Inter',ui-sans-serif,system-ui,sans-serif] text-slate-900 sm:px-6 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md space-y-6">
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
          <span className="font-['Space_Grotesk',sans-serif] text-lg font-bold tracking-tight">
            OpsKnight
          </span>
        </a>
        <section
          role="alert"
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h1 className="font-['Space_Grotesk',sans-serif] text-xl font-bold tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{body}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {reference && <>Reference: {reference}. </>}
            <a
              href={MCP_DOCS_LINKS.troubleshooting}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              Troubleshooting guide
            </a>
          </p>
        </section>
        <Link
          href="/settings/integrations/mcp"
          className="inline-block rounded text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          Back to OpsKnight
        </Link>
      </div>
    </main>
  );
}

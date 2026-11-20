import AuthBrand from '@/components/auth/AuthBrand';
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8 font-sans text-foreground sm:px-6">
      <div className="w-full max-w-md space-y-6">
        <AuthBrand />
        <section
          role="alert"
          className="space-y-3 rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{body}</p>
          <p className="text-xs text-muted-foreground">
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
          className="inline-block rounded text-sm font-medium text-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to OpsKnight
        </Link>
      </div>
    </main>
  );
}

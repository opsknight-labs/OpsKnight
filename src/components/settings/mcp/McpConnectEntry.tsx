import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { McpLogo } from '@/components/common/BrandLogos';
import { mcpHref } from '@/app/(app)/settings/integrations/mcp/list-params';

/**
 * A small pointer to the MCP Connect tab, for everyone. Render it only while MCP is in force
 * (loadMcpInForce), so nobody is sent to set up something that is turned off.
 */
export default function McpConnectEntry({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="mcp-connect-entry-title"
      className={`flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between md:px-6 ${className ?? ''}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <McpLogo className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h2 id="mcp-connect-entry-title" className="font-display text-base font-semibold">
            Connect an AI assistant
          </h2>
          <p className="text-sm text-muted-foreground">
            Use OpsKnight from Claude, ChatGPT, Cursor or VS Code. The assistant works with your own
            permissions, and you can disconnect it any time.
          </p>
        </div>
      </div>
      <Link
        href={mcpHref({ tab: 'connect' })}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Set up a connection
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

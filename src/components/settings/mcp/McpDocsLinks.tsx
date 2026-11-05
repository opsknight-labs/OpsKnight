import { BookOpen } from 'lucide-react';
import { MCP_DOCS_LINKS } from '@/lib/mcp/docs-links';

const LINKS = [
  { href: MCP_DOCS_LINKS.guide, label: 'Setup guide' },
  { href: MCP_DOCS_LINKS.troubleshooting, label: 'Troubleshooting' },
  { href: MCP_DOCS_LINKS.permissions, label: 'Permissions reference' },
] as const;

/** Links to the MCP documentation, shown next to setup and connection instructions. */
export default function McpDocsLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="MCP documentation" className={className}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Documentation:</span>
        {LINKS.map(link => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {link.label}
          </a>
        ))}
      </p>
    </nav>
  );
}

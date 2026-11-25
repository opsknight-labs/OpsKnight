'use client';

import { Copy, FileText, Link as LinkIcon, Share2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { CHIP_CLASS } from '../field-styles';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify.success(`${what} copied`);
  } catch {
    notify.error('Could not copy');
  }
}

/** One "Share" control for the incident: link, paste-ready summary, ID (S still copies the summary). */
export default function ShareMenu({
  id,
  url,
  summary,
  iconOnly = false,
}: {
  id: string;
  url: string;
  summary: string;
  iconOnly?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Share: copy link, summary or ID"
          className={cn(
            CHIP_CLASS,
            'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            iconOnly && 'px-2'
          )}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          {!iconOnly && 'Share'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => copy(url, 'Link')} className="gap-2 text-xs">
          <LinkIcon className="h-3.5 w-3.5" aria-hidden />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(summary, 'Summary')} className="gap-2 text-xs">
          <FileText className="h-3.5 w-3.5" aria-hidden />
          <span className="flex-1">Copy summary</span>
          <kbd className="rounded border border-border px-1 font-mono text-2xs text-muted-foreground">
            S
          </kbd>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(id, 'ID')} className="gap-2 text-xs">
          <Copy className="h-3.5 w-3.5" aria-hidden />
          <span className="flex-1">Copy ID</span>
          <span className="font-mono text-2xs text-muted-foreground">#{id.slice(0, 8)}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The ID in the title card's meta line; clicking copies the full ID. */
export function CopyIdText({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => copy(id, 'ID')}
      title="Copy incident ID"
      className="font-mono text-muted-foreground hover:text-foreground hover:underline"
    >
      #{id.slice(0, 8)}
    </button>
  );
}

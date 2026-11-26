'use client';

import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

/** Copies the page's own URL (without the tab or other query) to the clipboard. */
export default function CopyLinkButton({ path, className }: { path: string; className?: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn('gap-1.5', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
          notify.success('Link copied');
        } catch {
          notify.error('Could not copy the link');
        }
      }}
    >
      <Link2 className="h-4 w-4" aria-hidden />
      Copy link
    </Button>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';

/**
 * While a settings form has unsaved edits: the browser asks before a reload or close, and an
 * in-page link (another tab, the sidebar) asks first in a dialog. Leaving replays the original
 * click so the link keeps its own navigation behaviour.
 */
export default function McpUnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const [link, setLink] = useState<HTMLAnchorElement | null>(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (
        bypass.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      // A jump within the page keeps the form and its edits.
      if (url.origin === current.origin && url.pathname === current.pathname) {
        if (url.search === current.search && url.hash) return;
      }
      event.preventDefault();
      event.stopPropagation();
      setLink(anchor);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);

  return (
    <Dialog
      open={Boolean(link)}
      onOpenChange={open => {
        if (!open) setLink(null);
      }}
    >
      <DialogContent>
        <DialogTitle>Leave with unsaved changes?</DialogTitle>
        <DialogDescription>
          Your policy changes are not saved yet. Leaving discards them.
        </DialogDescription>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setLink(null)}>
            Keep editing
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              const target = link;
              setLink(null);
              if (!target) return;
              bypass.current = true;
              try {
                target.click();
              } finally {
                bypass.current = false;
              }
            }}
          >
            Discard and leave
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

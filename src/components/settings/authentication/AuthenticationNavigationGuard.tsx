'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { useAuthenticationWorkspace } from './useAuthenticationController';

/** Keep draft secrets in memory; intercept in-app links before Next handles them. */
export default function AuthenticationNavigationGuard() {
  const { draftDirty, generatedRecovery, discardDraft, router } = useAuthenticationWorkspace();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!draftDirty && !generatedRecovery) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (
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
      const remaining = (value: URL) => {
        const params = new URLSearchParams(value.search);
        params.delete('authTab');
        params.delete('authView');
        params.sort();
        return params.toString();
      };
      const onlyAuthTab =
        url.pathname === current.pathname && remaining(url) === remaining(current);
      if (onlyAuthTab && url.origin === current.origin) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(url.href);
    };
    const settingsNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ parameter: string; value: string }>).detail;
      if (detail.parameter !== 'section' || detail.value === 'sso') return;
      event.preventDefault();
      const url = new URL(window.location.href);
      url.searchParams.set('section', detail.value);
      url.searchParams.delete('authTab');
      url.searchParams.delete('authView');
      setDestination(url.href);
    };
    window.addEventListener('opsknight:settings-navigation', settingsNavigation);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('opsknight:settings-navigation', settingsNavigation);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [draftDirty, generatedRecovery]);
  return (
    <Dialog
      open={Boolean(destination)}
      onOpenChange={open => {
        if (!open) setDestination(null);
      }}
    >
      <DialogContent>
        <DialogTitle>
          {generatedRecovery
            ? 'Store your recovery password first'
            : 'Leave with unstaged changes?'}
        </DialogTitle>
        <DialogDescription>
          {generatedRecovery
            ? 'Acknowledge secure storage in the password display before leaving this workspace.'
            : 'Your provider, access and session edits are held only in this browser tab. Leaving discards the shared draft.'}
        </DialogDescription>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDestination(null)}>
            Keep editing
          </Button>
          {!generatedRecovery && (
            <Button
              variant="destructive"
              onClick={() => {
                if (!destination) return;
                const url = new URL(destination);
                discardDraft();
                setDestination(null);
                if (url.origin === window.location.origin)
                  router.push(`${url.pathname}${url.search}${url.hash}`);
                else window.location.assign(url.href);
              }}
            >
              Discard and leave
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

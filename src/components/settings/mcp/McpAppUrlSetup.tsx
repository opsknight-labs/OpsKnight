'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

/**
 * Sets the same App URL as Settings → System, offered here because MCP cannot start without it.
 * It is prefilled with the address the administrator is using right now.
 */
export default function McpAppUrlSetup({ revision }: { revision: string | null }) {
  const [value, setValue] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.origin
  );
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-2"
      onSubmit={event => {
        event.preventDefault();
        startTransition(async () => {
          try {
            const response = await fetch('/api/settings/app-url', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ appUrl: value.trim(), expectedUpdatedAt: revision }),
            });
            if (!response.ok)
              throw new Error('Could not save the App URL. Check the address and try again.');
            notify.success('App URL saved', { id: 'settings:mcp:app-url' });
            router.refresh();
          } catch (error) {
            notify.error(error, { id: 'settings:mcp:app-url' });
          }
        });
      }}
    >
      <Label htmlFor="mcp-app-url">App URL</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="mcp-app-url"
          type="url"
          required
          value={value}
          onChange={event => setValue(event.target.value)}
          placeholder="https://ops.your-company.com"
          className="min-w-0 max-w-sm flex-1"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Use this address'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The address people open OpsKnight at, including https. It is also used for sign-in links, so
        make sure it is the public address and not an internal one.
      </p>
    </form>
  );
}

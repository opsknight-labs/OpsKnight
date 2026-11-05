'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { signInAgainForMcp } from '@/components/settings/mcp/McpPolicyForm';
import { MCP_REAUTHENTICATION_MESSAGE } from '@/lib/mcp/auth/policy-widening';

/** First-run shortcut: one click turns on read-only access with automatic connections. */
export default function McpQuickSetup({
  action,
  blocked,
}: {
  action: () => Promise<{ ok: false; code: string } | void>;
  blocked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      type="button"
      className="gap-2"
      disabled={pending || blocked}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await action();
            if (result && !result.ok) {
              // Turning access on needs a recent sign-in; offer it instead of a bare error.
              notify.error(MCP_REAUTHENTICATION_MESSAGE, {
                id: 'settings:mcp:quick',
                action: { label: 'Sign in again', onClick: signInAgainForMcp },
              });
              return;
            }
            notify.success('AI assistant access is on', { id: 'settings:mcp:quick' });
            router.refresh();
          } catch (error) {
            notify.error(error, { id: 'settings:mcp:quick' });
          }
        })
      }
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      {pending ? 'Turning on…' : 'Turn on AI assistant access'}
    </Button>
  );
}

'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';

/** First-run shortcut: one click turns on read-only access with automatic connections. */
export default function McpQuickSetup({
  action,
  blocked,
}: {
  action: () => Promise<void>;
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
            await action();
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

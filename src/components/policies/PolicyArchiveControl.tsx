'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPolicyArchived } from '@/app/(app)/policies/actions';
import { Button } from '@/components/ui/shadcn/button';

export default function PolicyArchiveControl({
  policyId,
  archived,
  blocked,
}: {
  policyId: string;
  archived: boolean;
  blocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={pending || (!archived && blocked)}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await setPolicyArchived(policyId, !archived);
              if (!result.ok) setError(result.error);
            } catch {
              setError('Unable to change the policy. Check your permissions and try again.');
            }
            router.refresh();
          });
        }}
      >
        {pending ? 'Saving…' : archived ? 'Restore policy' : 'Archive policy'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

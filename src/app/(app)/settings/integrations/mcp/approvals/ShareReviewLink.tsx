'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { copyAuthenticationText } from '@/components/settings/authentication/clipboard';

/**
 * Copies this review page's address so the requester can send it to someone allowed to approve.
 * Reviewers are only notified inside OpsKnight; the link itself grants nothing.
 */
export default function ShareReviewLink() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={async () =>
          setStatus((await copyAuthenticationText(window.location.href)) ? 'copied' : 'failed')
        }
      >
        {status === 'copied' ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Copy review link
      </Button>
      <p role="status" className="text-xs text-muted-foreground">
        {status === 'copied'
          ? 'Link copied. Only people allowed to review can use it.'
          : status === 'failed'
            ? 'Copy failed. Copy the address from your browser instead.'
            : 'Send it to someone who can review this request.'}
      </p>
    </div>
  );
}

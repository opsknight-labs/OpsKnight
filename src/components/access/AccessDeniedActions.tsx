'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

export function BackButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Go back
    </Button>
  );
}

/** Copies a short support summary (no resource contents) so people can share it with an admin. */
export function CopyDetailsButton({ details }: { details: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(details);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? 'Copied' : 'Copy details'}
    </Button>
  );
}

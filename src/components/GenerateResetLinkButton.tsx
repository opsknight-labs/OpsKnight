'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { Loader2, Key, Copy, Check, X, AlertCircle, Link as LinkIcon } from 'lucide-react';

type Props = {
  userId: string;
  userName: string;
  userStatus?: string;
  className?: string;
};

export default function GenerateResetLinkButton({
  userId,
  userName,
  userStatus = 'ACTIVE',
  className,
}: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const isInvite = userStatus === 'INVITED';
  const buttonLabel = isInvite ? 'Get Invite Link' : 'Reset Password';
  const confirmLabel = isInvite ? 'Generate Link?' : 'Reset Password?';

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);
    setResetLink(null);

    try {
      const res = await fetch('/api/admin/generate-reset-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const friendly = toUserFacingError(
          await errorFromResponse(res, 'Failed to generate link')
        );
        setError(friendly.description || friendly.title);
        setConfirming(false);
        return;
      }

      const data = await res.json();
      if (data.link) {
        setResetLink(data.link);
      } else {
        setError('Failed to generate link');
        setConfirming(false);
      }
    } catch (err) {
      const friendly = toUserFacingError(err, 'Failed to generate link');
      setError(friendly.description || friendly.title);
      setConfirming(false);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (resetLink) {
      navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (resetLink) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
        <Button
          onClick={copyToClipboard}
          variant="outline"
          size="sm"
          className="h-7 text-xs bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:text-green-800 gap-2"
          title="Click to copy link"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> Copied!
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy Link
            </>
          )}
        </Button>
        <Button
          onClick={() => {
            setResetLink(null);
            setConfirming(false);
          }}
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          title="Close"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1 animate-in fade-in">
        <Button
          onClick={handleGenerate}
          disabled={isLoading}
          variant="destructive"
          size="sm"
          className="h-7 text-xs gap-1"
        >
          {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
          Confirm
        </Button>
        <Button
          onClick={() => setConfirming(false)}
          disabled={isLoading}
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
        >
          <X className="h-3 w-3" />
        </Button>
        {error && (
          <span className="text-xs text-red-500 ml-1" title={error}>
            <AlertCircle className="h-3 w-3" />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        onClick={() => setConfirming(true)}
        variant="ghost"
        size="sm"
        className={`h-7 text-xs gap-1.5 ${isInvite ? 'text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100' : 'text-green-600 bg-green-50 border border-green-200 hover:bg-green-100'} ${className}`}
        title={buttonLabel}
      >
        {isInvite ? <LinkIcon className="h-3 w-3" /> : <Key className="h-3 w-3" />}
        {buttonLabel}
      </Button>
      {error && (
        <span className="text-xs text-red-500" title={error}>
          !
        </span>
      )}
    </div>
  );
}

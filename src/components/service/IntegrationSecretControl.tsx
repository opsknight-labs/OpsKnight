'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Key, RefreshCw, Trash2 } from 'lucide-react';
import CopyButton from '@/components/service/CopyButton';
import { rotateIntegrationSecret, clearIntegrationSecret } from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';

interface IntegrationSecretControlProps {
  integrationId: string;
  serviceId: string;
  hasSecret?: boolean;
  initialSecret?: string | null;
  /** False for providers that cannot sign requests with this secret. */
  signingSupported?: boolean;
  className?: string;
}

export default function IntegrationSecretControl({
  integrationId,
  serviceId,
  hasSecret,
  initialSecret,
  signingSupported = true,
  className,
}: IntegrationSecretControlProps) {
  const isInitiallyConfigured = Boolean(hasSecret ?? initialSecret);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(isInitiallyConfigured);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(initialSecret || null);

  const handleRotate = async () => {
    setLoading(true);
    try {
      const result = await rotateIntegrationSecret(integrationId, serviceId);
      setConfigured(true);
      setRevealedSecret(result.secret);
      notify.success('Secret rotated successfully');
    } catch (_error) {
      notify.error('Failed to rotate secret');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      await clearIntegrationSecret(integrationId, serviceId);
      setConfigured(false);
      setRevealedSecret(null);
      notify.success('Secret cleared successfully');
    } catch (_error) {
      notify.error('Failed to clear secret');
    } finally {
      setLoading(false);
    }
  };

  if (!configured && !signingSupported) return null;

  if (!configured) {
    return (
      <div className={`space-y-1.5 ${className || ''}`}>
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Key className="h-3 w-3" />
            <span>Signature Secret</span>
            <span className="text-[10px] font-normal lowercase tracking-normal text-muted-foreground/80 bg-muted px-1.5 py-0.2 rounded border border-border/60">
              optional
            </span>
          </div>
        </div>
        <div className="bg-muted/20 border border-dashed border-border/80 rounded-lg p-2.5 text-xs flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground italic">
            No secret configured (Signature verification disabled)
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRotate}
            disabled={loading}
            className="h-7 text-xs shrink-0 font-medium"
          >
            <RefreshCw className={`mr-1.5 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Generate Secret
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className || ''}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Key className="h-3 w-3" />
          <span>Signature Secret</span>
          <span className="text-[10px] font-normal lowercase tracking-normal text-muted-foreground/80 bg-muted px-1.5 py-0.2 rounded border border-border/60">
            optional
          </span>
        </div>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Verification Active
        </span>
      </div>
      <div className="bg-background border border-border rounded-lg px-2.5 py-1.5 font-mono text-xs flex items-center justify-between gap-2 shadow-xs group">
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          <span className="truncate text-foreground font-mono">
            {revealedSecret || '••••••••••••••••••••••••••••••••'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {revealedSecret && <CopyButton text={revealedSecret} />}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title="Rotate Secret"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogDescription>
                  This will generate a new secret. The old secret will stop working immediately. You
                  will need to update your external webhook configuration.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRotate}>Rotate Secret</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                title="Remove Secret"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disable Signature Verification?</AlertDialogTitle>
                <AlertDialogDescription>
                  Removing the secret will <strong>disable signature verification</strong> for this
                  integration. Webhooks will continue to be processed without HMAC checks. Are you
                  sure you want to remove this secret?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClear}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Disable Verification
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {signingSupported ? (
        <p className="text-[10px] text-muted-foreground">
          Inbound webhooks must be HMAC-signed with this secret.{' '}
          <span className="text-amber-600/90 dark:text-amber-400/90">Keep it private.</span>
        </p>
      ) : (
        <p role="alert" className="text-[10px] text-amber-600 dark:text-amber-400">
          This provider cannot sign webhooks with this secret. Remove it: it does not protect the
          endpoint and can cause deliveries to be rejected.
        </p>
      )}
    </div>
  );
}

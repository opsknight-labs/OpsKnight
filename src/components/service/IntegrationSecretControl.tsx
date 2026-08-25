'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Key, RefreshCw, Trash2 } from 'lucide-react';
import CopyButton from '@/components/service/CopyButton';
import { rotateIntegrationSecret, clearIntegrationSecret } from '@/app/(app)/services/actions';
import { useToast } from '@/hooks/use-product-notification';
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
  hasSecret: boolean;
  className?: string;
}

export default function IntegrationSecretControl({
  integrationId,
  serviceId,
  hasSecret,
  className,
}: IntegrationSecretControlProps) {
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(hasSecret);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const { showToast } = useToast();

  const handleRotate = async () => {
    setLoading(true);
    try {
      const result = await rotateIntegrationSecret(integrationId, serviceId);
      setConfigured(true);
      setRevealedSecret(result.secret);
      showToast('Secret rotated successfully', 'success');
    } catch (_error) {
      showToast('Failed to rotate secret', 'error');
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
      showToast('Secret cleared successfully', 'success');
    } catch (_error) {
      showToast('Failed to clear secret', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!configured) {
    return (
      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
          <Key className="h-3 w-3" /> Signature Secret
        </div>
        <div className="bg-slate-50 border border-dashed rounded px-3 py-2 text-xs flex items-center justify-between gap-2">
          <span className="text-slate-400 italic">
            No secret configured (Signature Verification disabled)
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRotate}
            disabled={loading}
            className="h-7 text-xs"
          >
            <RefreshCw className={`mr-1.5 h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Generate
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className || ''}`}>
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
        <Key className="h-3 w-3" /> Signature Secret
      </div>
      <div className="bg-white border rounded px-2 py-1.5 font-mono text-xs flex items-center justify-between gap-2 shadow-sm group">
        <div className="flex items-center gap-2 overflow-hidden flex-1">
          <span className="truncate text-slate-600">{revealedSecret || '••••••••••••••••'}</span>
        </div>
        <div className="flex items-center gap-1">
          {revealedSecret && <CopyButton text={revealedSecret} />}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-slate-400 hover:text-blue-600"
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
                className="h-6 w-6 text-slate-400 hover:text-red-600"
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
                  integration. Any valid webhook request will be accepted without a signature check.
                  Are you sure you want to do this?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClear} className="bg-red-600 hover:bg-red-700">
                  Disable Security
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">
        Use this secret in the external service to sign requests.{' '}
        <span className="text-amber-600/80">Keep it private.</span>
      </p>
    </div>
  );
}

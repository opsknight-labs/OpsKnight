'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { notify as toast } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
  KeyRound,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { SlackLogo } from '@/components/common/BrandLogos';
import { toneClasses } from '@/components/patterns';
import { cn } from '@/lib/utils';

/**
 * Lets an admin supply or rotate the Slack signing secret on an already-configured workspace.
 */
export default function SlackSigningSecretCard({ isConfigured }: { isConfigured: boolean }) {
  const router = useRouter();
  const [signingSecret, setSigningSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(!isConfigured);

  const handleSave = async () => {
    if (!signingSecret.trim()) {
      toast.error('Signing Secret required', {
        description: 'Paste the value from Slack > Basic Information > Signing Secret',
      });
      return;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('signingSecret', signingSecret.trim());

      const response = await fetch('/api/settings/slack-oauth', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.error) {
        toast.error('Failed to save Signing Secret', {
          description: data?.error || 'Please try again.',
        });
        return;
      }

      toast.success('Signing Secret saved', {
        id: 'settings:slack:signing-secret:save',
        description: 'Slack commands, buttons and events are verified from now on.',
      });
      setSigningSecret('');
      setIsEditing(false);
      router.refresh();
    } catch (error) {
      toast.error('Failed to save Signing Secret', {
        description: error instanceof Error ? error.message : 'Unexpected error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-2 rounded-lg border shrink-0',
              toneClasses(isConfigured ? 'ok' : 'critical').soft
            )}
          >
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <SlackLogo className="h-4 w-4 shrink-0" />
              <h3 className="text-base font-semibold text-foreground">Slack Signing Secret</h3>
              <Badge
                variant={isConfigured ? 'success' : 'destructive'}
                className="text-2xs font-semibold gap-1"
              >
                {isConfigured ? (
                  <>
                    <ShieldCheck className="h-3 w-3" />
                    HMAC Verified
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3" />
                    Secret Missing
                  </>
                )}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verifies that inbound slash commands, interactive button actions, and emoji reaction
              events genuinely come from Slack.
            </p>
          </div>
        </div>

        {isConfigured && !isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="h-8 text-xs font-semibold self-start sm:self-auto"
          >
            Rotate Secret
          </Button>
        )}
      </div>

      {isConfigured && !isEditing ? (
        <div
          className={cn(
            'rounded-lg border p-3.5 flex items-start gap-3 text-xs',
            toneClasses('ok').soft
          )}
        >
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="font-semibold">Request Signature Verification Active</p>
            <p className="text-muted-foreground">
              Inbound payloads from Slack are cryptographically validated against your encrypted
              signing secret with replay protection.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          {!isConfigured && (
            <div
              className={cn(
                'rounded-lg border p-3.5 text-xs flex items-start gap-2.5',
                toneClasses('critical').soft
              )}
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">
                Without a signing secret, slash commands like{' '}
                <code className="bg-background/60 font-mono px-1 rounded">/incident</code>,
                interactive acknowledgment buttons, and reaction sync will be rejected to protect
                your workspace.
              </p>
            </div>
          )}

          <div className="space-y-2 max-w-xl">
            <div className="flex items-center justify-between">
              <Label htmlFor="slackSigningSecret" className="text-sm font-medium">
                App Signing Secret
                <span className="ml-1 text-destructive" aria-hidden="true">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </Label>
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                <span>Find in Slack Basic Info</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="relative">
              <Input
                id="slackSigningSecret"
                type={showSecret ? 'text' : 'password'}
                value={signingSecret}
                onChange={e => setSigningSecret(e.target.value)}
                placeholder="Paste 32-character Signing Secret"
                className="font-mono text-xs h-9 pr-10"
                aria-describedby="slackSigningSecret-help"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showSecret ? 'Hide signing secret' : 'Show signing secret'}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p id="slackSigningSecret-help" className="text-xs text-muted-foreground">
              Found under <strong>Slack App Console</strong> → <strong>Basic Information</strong> →{' '}
              <strong>App Credentials</strong> → <strong>Signing Secret</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handleSave}
              disabled={!signingSecret.trim() || isSaving}
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Save Signing Secret
                </>
              )}
            </Button>
            {isConfigured && isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsEditing(false);
                  setSigningSecret('');
                }}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

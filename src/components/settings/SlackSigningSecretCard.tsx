'use client';

import { useState } from 'react';
import { notify as toast } from '@/lib/toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { AlertTriangle, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';

/**
 * Lets an admin supply the Slack signing secret on an already-configured
 * workspace.
 *
 * The guided setup only renders before Slack is connected, so without this an
 * existing install has nowhere to enter the secret. Slack never returns it from
 * OAuth — it is an app-level credential — so reconnecting cannot supply it
 * either, and inbound requests stay rejected until it is set.
 */
export default function SlackSigningSecretCard({ isConfigured }: { isConfigured: boolean }) {
  const [signingSecret, setSigningSecret] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
        description: 'Slack commands, buttons and events are verified from now on.',
      });
      setSigningSecret('');
      window.location.reload();
    } catch (error) {
      toast.error('Failed to save Signing Secret', {
        description: error instanceof Error ? error.message : 'Unexpected error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isConfigured) {
    return (
      <Alert className="mb-4">
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
        <AlertTitle>Request verification active</AlertTitle>
        <AlertDescription>
          A signing secret is configured, so slash commands, interactive buttons and events are
          verified as genuinely coming from Slack.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Signing Secret required</AlertTitle>
      <AlertDescription>
        <p className="mb-3">
          Slack requests cannot be verified without it, so slash commands, interactive buttons and
          emoji events are all rejected. Slack does not provide this during OAuth — reconnecting
          will not fill it in.
        </p>

        <div className="space-y-2 max-w-md">
          <Label htmlFor="slackSigningSecret">Signing Secret</Label>
          <Input
            id="slackSigningSecret"
            type="password"
            value={signingSecret}
            onChange={e => setSigningSecret(e.target.value)}
            placeholder="Paste Signing Secret here"
            className="font-mono"
          />
          <div className="flex items-center gap-2 pt-1">
            <Button onClick={handleSave} disabled={!signingSecret.trim() || isSaving} size="sm">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Signing Secret
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Basic Information
              </a>
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

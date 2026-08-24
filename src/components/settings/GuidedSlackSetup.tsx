'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Slack, ExternalLink, Copy, CheckCircle2, ArrowRight, ArrowLeft, Info } from 'lucide-react';
import { notify as toast } from '@/lib/toast';
import SlackManifestCard from '@/components/settings/SlackManifestCard';

type SetupStep = 1 | 2 | 3;

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://yourdomain.com';
}

export default function GuidedSlackSetup() {
  const [step, setStep] = useState<SetupStep>(1);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  const redirectUri = `${getBaseUrl()}/api/slack/oauth/callback`;

  const handleSave = async () => {
    if (!clientId || !clientSecret || !signingSecret) {
      toast.error('Missing credentials', {
        description: 'Please enter the Client ID, Client Secret and Signing Secret',
      });
      return;
    }

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('clientId', clientId);
      formData.append('clientSecret', clientSecret);
      formData.append('signingSecret', signingSecret);
      formData.append('redirectUri', redirectUri);
      formData.append('enabled', 'true');

      const response = await fetch('/api/settings/slack-oauth', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        toast.success('OAuth configuration saved!');
        router.refresh();
        setStep(3);
      } else {
        const error = await response.json();
        toast.error('Failed to save configuration', {
          description: error.error || 'Please check your credentials and try again',
        });
      }
    } catch (error) {
      toast.error('Failed to save configuration', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    toast.success('Copied to clipboard!', {
      description: 'Redirect URI has been copied',
    });
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Slack className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Setup Wizard</CardTitle>
              <CardDescription className="mt-1.5">
                Follow these steps to connect your Slack workspace. Takes less than 2 minutes!
              </CardDescription>
            </div>
          </div>
          <Badge variant="secondary">3 Steps</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3].map((s, index) => (
            <div key={s} className="flex items-center">
              <div
                className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-medium transition-all ${
                  step === s
                    ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                    : step > s
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
              </div>
              {index < 2 && (
                <div
                  className={`h-0.5 w-12 mx-2 transition-all ${
                    step > s ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Create Slack App */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="mb-6 rounded-lg border bg-background p-4">
              <SlackManifestCard baseUrl={getBaseUrl()} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  1
                </div>
                <h3 className="text-lg font-semibold">Create a Slack App</h3>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  You&apos;ll create a new Slack App in your workspace. This gives OpsKnight
                  permission to send notifications to your channels.
                </AlertDescription>
              </Alert>

              <div className="space-y-4 pl-8">
                <div className="space-y-2">
                  <p className="text-sm">
                    <strong>Step 1:</strong> Click the button below to open Slack API Console
                  </p>
                  <Button asChild variant="outline" className="w-full">
                    <a
                      href="https://api.slack.com/apps?new_app=1"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Create New Slack App
                    </a>
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-sm">
                    <strong>Step 2:</strong> Fill in the app details
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>
                      App Name: <code className="bg-muted px-1 py-0.5 rounded">OpsKnight</code> (or
                      any name you prefer)
                    </li>
                    <li>Pick Workspace: Select your Slack workspace</li>
                    <li>Click &quot;Create App&quot;</li>
                  </ul>
                </div>

                <Alert variant="default" className="bg-muted/50">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Tip:</strong> Keep the Slack API tab open - you&apos;ll need it in the
                    next step!
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={() => setStep(2)}>
                I&apos;ve Created the App
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Configure OAuth */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  2
                </div>
                <h3 className="text-lg font-semibold">Configure OAuth & Get Credentials</h3>
              </div>

              {/* 2a: Configure Redirect URL */}
              <div className="space-y-3 pl-8">
                <h4 className="text-sm font-semibold">2a. Configure OAuth Redirect URL</h4>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>
                    In your Slack app, click &quot;OAuth & Permissions&quot; in the left sidebar
                  </li>
                  <li>Scroll to &quot;Redirect URLs&quot; section</li>
                  <li>Click &quot;Add New Redirect URL&quot;</li>
                  <li>Paste this URL and click &quot;Add&quot;:</li>
                </ol>
                <div className="flex gap-2">
                  <Input value={redirectUri} readOnly className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={handleCopyRedirectUri}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* 2b: Add Bot Scopes */}
              <div className="space-y-3 pl-8">
                <h4 className="text-sm font-semibold">2b. Add Bot Token Scopes</h4>
                <p className="text-sm text-muted-foreground">
                  Scroll to &quot;Scopes&quot; → &quot;Bot Token Scopes&quot; and add these:
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'chat:write',
                    'channels:read',
                    'channels:join',
                    'channels:manage',
                    'channels:history',
                    'reactions:read',
                    'users:read',
                    'users:read.email',
                    'groups:read',
                    'groups:write',
                    'groups:history',
                    'im:read',
                    'mpim:read',
                  ].map(scope => (
                    <Badge key={scope} variant="secondary" size="xs" className="font-mono">
                      {scope}
                    </Badge>
                  ))}
                </div>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>channels:manage</strong> creates incident war-room channels,{' '}
                    <strong>users:read.email</strong> matches Slack users to OpsKnight accounts so
                    responders are auto-invited, and <strong>reactions:read</strong> plus{' '}
                    <strong>channels:history</strong> capture 📌 pinned messages as incident notes.
                    The <strong>groups:*</strong> scopes add private channel support.
                  </AlertDescription>
                </Alert>
              </div>

              {/* 2b-ii: Event Subscriptions */}
              <div className="space-y-3 pl-8">
                <h4 className="text-sm font-semibold">2b-ii. Enable Event Subscriptions</h4>
                <p className="text-sm text-muted-foreground">
                  Open &quot;Event Subscriptions&quot;, turn it on, and set the Request URL:
                </p>
                <Input value={`${getBaseUrl()}/api/slack/events`} readOnly className="font-mono" />
                <p className="text-sm text-muted-foreground">
                  Then under &quot;Subscribe to bot events&quot; add{' '}
                  <Badge variant="secondary" size="xs" className="font-mono">
                    reaction_added
                  </Badge>
                </p>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Without this, reacting 📌 to a message will not save it to the incident. This is
                    separate from Interactivity — buttons can work while events do not.
                  </AlertDescription>
                </Alert>
              </div>

              {/* 2c: Copy Credentials */}
              <div className="space-y-3 pl-8">
                <h4 className="text-sm font-semibold">2c. Copy Your Credentials</h4>
                <p className="text-sm text-muted-foreground">
                  Still on &quot;OAuth & Permissions&quot; page, find these at the top:
                </p>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="clientId">
                      Client ID <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="clientId"
                      type="text"
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                      placeholder="Paste Client ID here"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Found at the top of OAuth & Permissions page
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="clientSecret">
                      Client Secret <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="clientSecret"
                      type="password"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      placeholder="Paste Client Secret here"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Click &quot;Show&quot; next to Client Secret in Slack, then copy it here
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signingSecret">
                      Signing Secret <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="signingSecret"
                      type="password"
                      value={signingSecret}
                      onChange={e => setSigningSecret(e.target.value)}
                      placeholder="Paste Signing Secret here"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Same page in Slack, just below Client Secret. Required to verify that slash
                      commands, buttons and events genuinely came from Slack — without it those
                      requests are rejected. Slack never sends this during OAuth, so reconnecting
                      will not fill it in.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleSave}
                disabled={!clientId || !clientSecret || !signingSecret || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save & Continue'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Connect */}
        {step === 3 && (
          <div className="space-y-6 text-center py-8">
            <div className="flex justify-center">
              <div className="p-4 rounded-full bg-green-500/10">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-semibold">Configuration Saved!</h3>
              <p className="text-muted-foreground">
                Your OAuth credentials have been saved. Now connect your Slack workspace to start
                receiving notifications.
              </p>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                You&apos;ll be redirected to Slack to authorize OpsKnight to access your workspace.
              </AlertDescription>
            </Alert>

            <Button size="lg" asChild>
              <a href="/api/slack/oauth">
                <Slack className="h-4 w-4 mr-2" />
                Connect to Slack
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

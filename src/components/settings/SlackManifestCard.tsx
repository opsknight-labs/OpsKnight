'use client';

import { useMemo, useState } from 'react';
import { notify as toast } from '@/lib/toast';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Check, Copy, ExternalLink, FileJson, Info } from 'lucide-react';
import { buildSlackAppManifestJson } from '@/lib/slack/app-manifest';

/**
 * Renders the complete Slack app manifest for this deployment.
 *
 * Slack can create an app directly from a manifest, which configures scopes,
 * Event Subscriptions, interactivity and the slash command in one step. Setting
 * those by hand is what produced every Slack misconfiguration we have hit:
 * missing reaction scopes, an events subscription that was never enabled, and a
 * slash-command hint advertising subcommands that do not exist.
 */
export default function SlackManifestCard({ baseUrl }: { baseUrl: string }) {
  const [copied, setCopied] = useState(false);
  const manifest = useMemo(() => buildSlackAppManifestJson({ baseUrl }), [baseUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(manifest);
      setCopied(true);
      toast.success('Manifest copied', {
        description: 'Paste it into Slack under "Create an app > From a manifest".',
      });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Could not copy', {
        description: 'Select the manifest text and copy it manually.',
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <FileJson className="h-4 w-4 text-blue-600" />
            App Manifest
            <Badge variant="secondary" size="xs">
              Recommended
            </Badge>
          </h4>
          <p className="text-sm text-muted-foreground">
            Configures every scope, the events subscription, interactivity and the{' '}
            <code className="font-mono text-xs">/incident</code> command in one step — no manual
            toggles to miss.
          </p>
        </div>
        <Button onClick={handleCopy} size="sm" variant={copied ? 'secondary' : 'default'}>
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? 'Copied' : 'Copy Manifest'}
        </Button>
      </div>

      <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono leading-relaxed">
        {manifest}
      </pre>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="space-y-2">
          <p>
            <strong>New app:</strong> Slack API → Create New App → <em>From a manifest</em> → pick
            your workspace → paste.
          </p>
          <p>
            <strong>Existing app:</strong> your app → <em>App Manifest</em> → replace and save, then
            reinstall so newly added scopes are granted. Slack does not grant new scopes to an
            existing installation until it is reinstalled.
          </p>
        </AlertDescription>
      </Alert>

      <Button asChild variant="ghost" size="sm">
        <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4 mr-2" />
          Open Slack API Console
        </a>
      </Button>
    </div>
  );
}

'use client';

import { useActionState, useState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { saveJiraConfig } from '@/app/(app)/settings/integrations/jira/actions';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';

type JiraConfigView = {
  baseUrl: string;
  userEmail: string;
  enabled: boolean;
  webhookSecretEncrypted: string | null;
  updatedAt: Date;
  updatedByUser?: {
    name: string | null;
    email: string;
  } | null;
} | null;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Save Jira Configuration
    </Button>
  );
}

export default function JiraIntegrationPage({
  config,
  isAdmin,
}: {
  config: JiraConfigView;
  isAdmin: boolean;
}) {
  const [state, formAction] = useActionState(saveJiraConfig, {
    error: null,
    success: false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string>('/api/jira/webhook');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/jira/webhook`);
    }
  }, []);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/jira/test', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Jira connection failed.');
      setTestResult({
        ok: true,
        message: data.displayName ? `Connected as ${data.displayName}` : 'Connected to Jira.',
      });
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : 'Jira connection failed.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Workspace Connection"
        description="Store one encrypted Jira credential used by incident and action-item workflows."
        action={
          <Badge variant={config?.enabled ? 'default' : 'secondary'}>
            {config?.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        }
      >
        <form action={formAction} className="space-y-6 py-6">
          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state?.success && (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription>Jira configuration saved.</AlertDescription>
            </Alert>
          )}
          {testResult && (
            <Alert
              variant={testResult.ok ? 'default' : 'destructive'}
              className={testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : ''}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Jira Site URL</Label>
              <Input
                id="baseUrl"
                name="baseUrl"
                defaultValue={config?.baseUrl ?? ''}
                placeholder="https://your-company.atlassian.net"
                required
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="userEmail">Jira User Email</Label>
              <Input
                id="userEmail"
                name="userEmail"
                type="email"
                defaultValue={config?.userEmail ?? ''}
                placeholder="ops@example.com"
                required
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiToken">API Token</Label>
              <Input
                id="apiToken"
                name="apiToken"
                type="password"
                defaultValue={config ? '********' : ''}
                placeholder="Paste Jira API token"
                disabled={!isAdmin}
                required={!config}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookSecret">Webhook Secret</Label>
              <Input
                id="webhookSecret"
                name="webhookSecret"
                type="password"
                defaultValue={config?.webhookSecretEncrypted ? '********' : ''}
                placeholder="Shared secret for Jira webhook requests"
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-2 md:col-span-2 mt-4 pt-4 border-t">
              <Label>Webhook URL (for Jira configuration)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={webhookUrl}
                  readOnly
                  className="bg-slate-50 font-mono text-xs text-muted-foreground"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                In Jira, create a webhook for <strong>issue_updated</strong> and{' '}
                <strong>issue_deleted</strong> events and point it to this URL. If you set a secret
                above, Jira must send it in an <code>x-jira-webhook-secret</code> header.
              </p>
            </div>

            <label className="flex items-center gap-3 rounded-md border p-3 text-sm md:col-span-2 mt-2">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={config?.enabled ?? true}
                disabled={!isAdmin}
                className="h-4 w-4"
              />
              Enable Jira workflows
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {config
                ? `Last updated by ${config.updatedByUser?.name || 'Administrator'} on ${new Date(config.updatedAt).toLocaleDateString()}`
                : 'No Jira workspace is connected yet.'}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!config || testing}
                onClick={testConnection}
              >
                {testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="mr-2 h-4 w-4" />
                )}
                Test Connection
              </Button>
              <SubmitButton disabled={!isAdmin} />
            </div>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}

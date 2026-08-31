'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createApiKey, revokeApiKey } from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/shadcn/table';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { EmptyState } from './feedback/EmptyState';
import CopyButton from './CopyButton';
import ConfirmDialog from './ConfirmDialog';
import { Key, CheckCircle2, XCircle, Loader2, Terminal } from 'lucide-react';

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  ownerEmail?: string;
};

type State = {
  error?: string | null;
  success?: boolean;
  token?: string | null;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Generating Key...' : 'Create API Key'}
    </Button>
  );
}

export default function ApiKeysPanel({
  keys,
  canCreateWriteKeys,
}: {
  keys: ApiKey[];
  canCreateWriteKeys: boolean;
}) {
  const [state, formAction] = useActionState<State, FormData>(createApiKey, {
    error: null,
    success: false,
    token: null,
  });
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);

  const handleRevoke = async (keyId: string) => {
    const formData = new FormData();
    formData.append('keyId', keyId);
    await revokeApiKey(formData);
    setRevokeKeyId(null);
    window.location.reload();
  };

  const scopes = [
    {
      value: 'events:write',
      title: 'Events Ingestion',
      detail: 'Send incoming alert payloads and telemetry',
      color: 'bg-rose-50 text-rose-700 border-rose-200',
      defaultChecked: true,
    },
    {
      value: 'incidents:read',
      title: 'Incidents Read',
      detail: 'Query active and historical incident states',
      color: 'bg-blue-50 text-blue-700 border-blue-200',
      defaultChecked: true,
    },
    {
      value: 'incidents:write',
      title: 'Incidents Write',
      detail: 'Acknowledge, resolve, and update incidents',
      color: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      value: 'services:read',
      title: 'Services Read',
      detail: 'Query service catalog and health status',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      value: 'schedules:read',
      title: 'Schedules Read',
      detail: 'Query on-call rotations and current responders',
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  ];
  const visibleScopes = canCreateWriteKeys
    ? scopes
    : scopes.filter(scope => !scope.value.endsWith(':write'));

  return (
    <div className="space-y-6">
      {/* 1. Create New API Key Card */}
      <Card className="border-slate-200 shadow-xs">
        <CardHeader className="pb-4 border-b border-slate-100">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Generate New API Key
          </CardTitle>
          <CardDescription>
            API keys allow external scripts, CI/CD pipelines, and monitoring systems to interact
            with OpsKnight securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={formAction} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="key-name" className="text-sm font-semibold">
                  Key Name / Purpose *
                </Label>
                <Input
                  id="key-name"
                  name="name"
                  placeholder="e.g., Datadog Webhook Ingest or GitHub Actions"
                  required
                  className="h-10"
                />
                <p className="text-[11px] text-muted-foreground">
                  A descriptive identifier to recognize where this key is deployed
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiration-days" className="text-sm font-semibold">
                  Expiration Lifetime
                </Label>
                <select
                  id="expiration-days"
                  name="expirationDays"
                  defaultValue="90"
                  className="flex h-10 w-full rounded-lg border border-slate-200 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="7">7 days (Short-lived testing)</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days (Recommended default)</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  Key will be automatically rejected after this duration
                </p>
              </div>
            </div>

            {/* Scopes Matrix */}
            <div className="space-y-3 rounded-xl border border-slate-200/80 bg-muted/10 p-4">
              <div>
                <Label className="text-sm font-semibold">Granular Permission Scopes</Label>
                <p className="text-xs text-muted-foreground">
                  Follow the principle of least privilege by selecting only necessary scopes
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleScopes.map(scope => (
                  <div
                    key={scope.value}
                    className="flex items-start space-x-3 rounded-xl border border-slate-200 bg-white p-3.5 hover:bg-slate-50 transition-colors"
                  >
                    <Checkbox
                      name="scopes"
                      value={scope.value}
                      defaultChecked={scope.defaultChecked}
                      id={scope.value}
                      className="mt-0.5"
                    />
                    <div className="flex-1 space-y-1">
                      <label
                        htmlFor={scope.value}
                        className="text-xs font-semibold leading-none cursor-pointer flex items-center justify-between"
                      >
                        <span>{scope.title}</span>
                        <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded text-slate-600 font-mono">
                          {scope.value}
                        </code>
                      </label>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {scope.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {state?.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            {state?.token && (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 animate-in fade-in-0 duration-200">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>API Key Generated Successfully</span>
                </div>
                <p className="text-xs text-emerald-700">
                  Please copy this key now and store it in a secure password manager or secret
                  vault. You will not be able to see it again!
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-white p-3">
                  <code className="flex-1 text-xs font-mono font-bold text-foreground break-all">
                    {state.token}
                  </code>
                  <CopyButton text={state.token} />
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <SubmitButton />
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 2. Active API Keys Table */}
      {keys.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No API keys generated"
          description="Generate your first API key above to enable webhook ingestion and automated incident management."
        />
      ) : (
        <Card className="border-slate-200 shadow-xs overflow-hidden">
          <CardHeader className="pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Configured API Keys</CardTitle>
                <CardDescription>
                  {keys.length} {keys.length === 1 ? 'key' : 'keys'} active in this workspace
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-semibold text-xs">Name</TableHead>
                  <TableHead className="font-semibold text-xs">Key Prefix</TableHead>
                  <TableHead className="font-semibold text-xs">Scopes</TableHead>
                  <TableHead className="font-semibold text-xs">Status</TableHead>
                  <TableHead className="font-semibold text-xs">Created</TableHead>
                  <TableHead className="font-semibold text-xs">Expires</TableHead>
                  <TableHead className="font-semibold text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map(key => {
                  const isRevoked = Boolean(key.revokedAt);
                  const isExpired = Boolean(key.expired);
                  const isActive = !isRevoked && !isExpired;

                  return (
                    <TableRow key={key.id} className="hover:bg-slate-50/80">
                      <TableCell className="font-medium text-xs text-foreground">
                        {key.name}
                        {key.ownerEmail && (
                          <span className="block text-[11px] text-muted-foreground font-normal">
                            {key.ownerEmail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs font-mono font-semibold bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded border border-slate-200">
                          {key.prefix}...
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {key.scopes.map(scope => (
                            <Badge
                              key={scope}
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-white"
                            >
                              {scope}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : isRevoked ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                            Revoked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                            Expired
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {key.createdAt}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {key.expiresAt || 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRevokeKeyId(key.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 3. API Usage Snippet Callout */}
      <div className="rounded-xl border border-slate-200 bg-slate-900 text-slate-100 p-4 space-y-2 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
          <Terminal className="h-4 w-4" />
          <span>Quick Authentication Example</span>
        </div>
        <p className="text-xs text-slate-300">
          Pass your API key in the standard{' '}
          <code className="text-amber-300 font-mono">Authorization: Bearer &lt;KEY&gt;</code> HTTP
          header:
        </p>
        <pre className="text-[11px] font-mono bg-black/50 p-2.5 rounded-lg overflow-x-auto text-emerald-300 border border-slate-800">
          curl -X POST https://api.opsknight.com/api/events \<br />
          &nbsp;&nbsp;-H &quot;Authorization: Bearer ops_live_your_api_key&quot; \<br />
          &nbsp;&nbsp;-H &quot;Content-Type: application/json&quot; \<br />
          &nbsp;&nbsp;-d &#39;&#123;&quot;service&quot;: &quot;payment-api&quot;, &quot;title&quot;:
          &quot;High Latency Alert&quot;&#125;&#39;
        </pre>
      </div>

      {/* Revoke Confirmation Dialog */}
      {revokeKeyId && (
        <ConfirmDialog
          open={true}
          title="Revoke API Key?"
          message="Are you sure you want to revoke this API key? Any applications or integrations using this key will immediately lose access."
          confirmLabel="Revoke Key"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={() => handleRevoke(revokeKeyId)}
          onCancel={() => setRevokeKeyId(null)}
        />
      )}
    </div>
  );
}

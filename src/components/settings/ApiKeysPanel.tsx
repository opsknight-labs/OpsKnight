'use client';

import { useState, useEffect } from 'react';
import { useSecretSafeAction } from './useSecretSafeAction';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createApiKey, revokeApiKey } from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { Badge } from '@/components/ui/shadcn/badge';
import { EmptyState } from './feedback/EmptyState';
import OneTimeSecretBanner from './OneTimeSecretBanner';
import {
  Key,
  XCircle,
  Loader2,
  Terminal,
  Plus,
  Code2,
  Clock,
  ShieldAlert,
  Send,
  Radio,
  FileText,
  Layers,
  Calendar,
  Bot,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { ALL_API_SCOPE_DEFINITIONS, issuableScopesForRole } from '@/lib/api-scope-registry';

export type ApiKey = {
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
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating Key...
        </>
      ) : (
        <>
          <Key className="h-4 w-4" />
          Generate API Key
        </>
      )}
    </Button>
  );
}

const SCOPE_CATEGORY_ICONS: Record<string, LucideIcon> = {
  Events: Send,
  Incidents: Radio,
  Services: Layers,
  Schedules: Calendar,
  Teams: Users,
  Users: Users,
  Escalations: ShieldAlert,
  Integrations: Code2,
  Notifications: Send,
  'Status pages': FileText,
  Runbooks: Terminal,
  Governance: Shield,
  Administration: Bot,
};

/**
 * Scopes offered for new keys. Derived from the shared registry (never a local list) and
 * limited to scopes the REST surface currently enforces.
 */
const SCOPES_CONFIG = ALL_API_SCOPE_DEFINITIONS.filter(
  definition => definition.status === 'active'
).map(definition => ({
  value: definition.scope as string,
  title: definition.title,
  detail: definition.description,
  icon: SCOPE_CATEGORY_ICONS[definition.category] ?? Key,
  category: definition.category,
  write: definition.write,
}));

function keysHref(
  inventory: { q: string; status: string },
  cursor?: string | null
): string {
  const params = new URLSearchParams({ tab: 'api-keys' });
  if (inventory.q) params.set('kq', inventory.q);
  if (inventory.status !== 'ALL') params.set('kstatus', inventory.status);
  if (cursor) params.set('kcursor', cursor);
  return `?${params.toString()}`;
}

export default function ApiKeysPanel({
  keys,
  canCreateWriteKeys,
  isAdmin = false,
  role,
  appUrl,
  inventory = { q: '', status: 'ALL', hasCursor: false, nextCursor: null, total: undefined },
}: {
  keys: ApiKey[];
  canCreateWriteKeys: boolean;
  isAdmin?: boolean;
  /** The viewer's role; decides which scopes may be issued. Derived from the flags when omitted. */
  role?: string;
  /** Server-side inventory state: filters live in the URL and paging runs in the database. */
  inventory?: {
    q: string;
    status: string;
    hasCursor: boolean;
    nextCursor: string | null;
    total?: number;
  };
  appUrl?: string;
}) {
  // The secret is held only in `revealedSecret`; dismissing the banner clears it, and the
  // action state itself never retains it (see useSecretSafeAction).
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [state, formAction] = useSecretSafeAction<State>(
    createApiKey,
    { error: null, success: false, token: null },
    setRevealedSecret
  );

  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.success) {
      setCreateDialogOpen(false);
    }
  }, [state?.success]);

  const effectiveRole = role ?? (isAdmin ? 'ADMIN' : canCreateWriteKeys ? 'RESPONDER' : 'USER');
  const issuable = new Set<string>(issuableScopesForRole(effectiveRole).map(d => d.scope));
  const visibleScopes = SCOPES_CONFIG.filter(scope => {
    if (!issuable.has(scope.value)) return false;
    if (scope.write && !canCreateWriteKeys) return false;
    return true;
  });

  const [selectedKeyScopes, setSelectedKeyScopes] = useState<Set<string>>(
    canCreateWriteKeys
      ? new Set(['events:write', 'incidents:read'])
      : new Set(['incidents:read'])
  );

  const applyKeyPreset = (type: 'ADMIN' | 'RESPONDER' | 'READ_ONLY' | 'CLEAR') => {
    if (type === 'CLEAR') {
      setSelectedKeyScopes(new Set());
    } else if (type === 'ADMIN') {
      setSelectedKeyScopes(new Set(visibleScopes.map(s => s.value)));
    } else if (type === 'RESPONDER') {
      setSelectedKeyScopes(
        new Set(
          [
            'events:write',
            'incidents:read',
            'incidents:write',
            'services:read',
            'schedules:read',
            'runbooks:read',
            'runbooks:execute',
            'notifications:read',
            'teams:read',
            'users:read',
          ].filter(s => visibleScopes.some(v => v.value === s))
        )
      );
    } else if (type === 'READ_ONLY') {
      setSelectedKeyScopes(new Set(visibleScopes.filter(s => !s.write).map(s => s.value)));
    }
  };

  const handleRevoke = async (keyId: string) => {
    setIsRevoking(true);
    setRevokeError(null);

    try {
      const formData = new FormData();
      formData.append('keyId', keyId);
      await revokeApiKey(formData);
      setRevokeKeyId(null);
      router.refresh();
    } catch (error) {
      setRevokeError(error instanceof Error ? error.message : 'Unable to revoke API key.');
    } finally {
      setIsRevoking(false);
    }
  };

  // Rows arrive already filtered and paged by the server (see lib/api-key-inventory).
  const filteredKeys = keys;
  const isFiltered = Boolean(inventory.q) || inventory.status !== 'ALL';

  const baseUrl = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://api.opsknight.com';

  return (
    <div className="space-y-6">
      {/* 1. Reveal Token Banner / Modal if just created */}
      {revealedSecret && (
        <OneTimeSecretBanner
          title="API Key Generated Successfully"
          badge="Secret Token"
          secret={revealedSecret}
          onDismiss={() => setRevealedSecret(null)}
          description={
            <>
              Copy this key now and store it in a password manager or CI/CD secret vault. For
              security reasons,{' '}
              <strong className="text-foreground">you will not be able to view this token again</strong>.
            </>
          }
        />
      )}

      {/* 2. Action and Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <form
            method="get"
            aria-label="Filter API keys"
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1"
          >
            <input type="hidden" name="tab" value="api-keys" />
            <div className="relative flex-1 min-w-[200px]">
              <Input
                name="kq"
                defaultValue={inventory.q}
                aria-label="Search keys"
                placeholder="Search by name, prefix, or owner..."
                className="h-9 text-xs bg-background"
              />
            </div>
            <select
              name="kstatus"
              defaultValue={inventory.status}
              aria-label="Key status"
              className="h-9 text-xs rounded-md border border-input bg-background px-2 min-w-[140px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active only</option>
              <option value="REVOKED">Revoked</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <Button type="submit" variant="outline" size="sm" className="h-9">
              Apply
            </Button>
            {(isFiltered || inventory.hasCursor) && (
              <Button asChild variant="ghost" size="sm" className="h-9">
                <Link href="?tab=api-keys">Reset</Link>
              </Button>
            )}
          </form>
        </div>

        <Button
          onClick={() => setCreateDialogOpen(true)}
          size="sm"
          className="gap-1.5 shrink-0 h-9"
        >
          <Plus className="h-4 w-4" />
          Generate API Key
        </Button>
      </div>

      {/* 3. API Keys Table / List */}
      {filteredKeys.length === 0 ? (
        <EmptyState
          icon={Key}
          title={isFiltered ? 'No matching API keys' : 'No API keys configured'}
          description={
            isFiltered
              ? 'Try adjusting your search terms or status filters.'
              : 'Generate your first API key above to enable webhook alert ingestion, CI/CD automation, and incident management.'
          }
          action={
            isFiltered ? (
              <Button asChild variant="outline" size="sm">
                <Link href="?tab=api-keys">Reset filters</Link>
              </Button>
            ) : (
              <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Generate API Key
              </Button>
            )
          }
        />
      ) : (
        <Card className="border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="pb-3 px-4 sm:px-5 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold">Configured API Keys</CardTitle>
                <CardDescription className="text-xs">
                  {inventory.total !== undefined
                    ? `${inventory.total} ${inventory.total === 1 ? 'key' : 'keys'} match`
                    : `${filteredKeys.length} ${filteredKeys.length === 1 ? 'key' : 'keys'}`}
                  {' · '}showing {filteredKeys.length}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-border/60">
                    <TableHead className="font-semibold text-xs py-3">Key Details</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Prefix</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Scopes</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Status</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Created</TableHead>
                    <TableHead className="font-semibold text-xs py-3">Expires</TableHead>
                    <TableHead className="font-semibold text-xs py-3 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredKeys.map(key => {
                    const isRevoked = Boolean(key.revokedAt);
                    const isExpired = Boolean(key.expired);
                    const isActive = !isRevoked && !isExpired;

                    return (
                      <TableRow
                        key={key.id}
                        className="hover:bg-muted/30 border-border/60 transition-colors"
                      >
                        <TableCell className="font-medium text-xs text-foreground py-3.5">
                          <div className="space-y-0.5">
                            <span className="font-bold text-foreground">{key.name}</span>
                            {key.ownerEmail && (
                              <span className="block text-[11px] text-muted-foreground font-normal">
                                {key.ownerEmail}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="py-3.5">
                          <code className="text-xs font-mono font-semibold bg-muted text-foreground px-2 py-0.5 rounded-md border border-border/60">
                            {key.prefix}...
                          </code>
                        </TableCell>

                        <TableCell className="py-3.5">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {key.scopes.map(scope => (
                              <Badge
                                key={scope}
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-background font-mono border-border/80"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>

                        <TableCell className="py-3.5">
                          {isActive ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 inline-flex items-center gap-1"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Active
                            </Badge>
                          ) : isRevoked ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 inline-flex items-center gap-1"
                            >
                              <ShieldAlert className="h-3 w-3" />
                              Revoked
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 inline-flex items-center gap-1"
                            >
                              <Clock className="h-3 w-3" />
                              Expired
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground py-3.5">
                          {key.createdAt}
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground py-3.5">
                          {key.expiresAt || 'Never'}
                        </TableCell>

                        <TableCell className="text-right py-3.5">
                          {isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRevokeKeyId(key.id)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs font-semibold"
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
            </div>
          </CardContent>
          {(inventory.hasCursor || inventory.nextCursor) && (
            <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
              {inventory.hasCursor && (
                <Button asChild variant="outline" size="sm">
                  <Link href={keysHref(inventory)}>Newest</Link>
                </Button>
              )}
              {inventory.nextCursor && (
                <Button asChild variant="outline" size="sm">
                  <Link href={keysHref(inventory, inventory.nextCursor)}>Older keys</Link>
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* 4. Developer Quickstart Guide & Code Snippets */}
      <Card className="border-border/80 shadow-xs bg-card overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">Developer API Quickstart</CardTitle>
                <CardDescription className="text-xs">
                  Pass your API key in the standard{' '}
                  <code className="text-foreground font-mono font-semibold bg-muted px-1.5 py-0.5 rounded border border-border/50">
                    Authorization: Bearer &lt;TOKEN&gt;
                  </code>{' '}
                  HTTP header.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <Tabs defaultValue="curl" className="w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <TabsList className="h-9 bg-muted/60">
                <TabsTrigger value="curl" className="text-xs gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  cURL
                </TabsTrigger>
                <TabsTrigger value="node" className="text-xs gap-1.5">
                  <Code2 className="h-3.5 w-3.5" />
                  Node.js / Fetch
                </TabsTrigger>
                <TabsTrigger value="python" className="text-xs gap-1.5">
                  <Code2 className="h-3.5 w-3.5" />
                  Python (requests)
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 px-2.5 py-1 rounded-md border border-border/40">
                <span>Header formats supported:</span>
                <code className="text-foreground font-mono font-semibold">
                  Bearer &lt;token&gt;
                </code>
                <span>or</span>
                <code className="text-foreground font-mono font-semibold">X-API-Key</code>
              </div>
            </div>

            {/* cURL Snippet */}
            <TabsContent value="curl" className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  1. Trigger / Ingest Alert (POST /api/events)
                </span>
                <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
                  <pre className="leading-relaxed">
                    {`curl -X POST ${baseUrl}/api/events \\
  -H "Authorization: Bearer ${revealedSecret || 'ok_live_your_api_key'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event_action": "trigger",
    "dedup_key": "api-gateway-5xx-spike",
    "payload": {
      "summary": "5xx Error Rate > 5% on Production API Gateway",
      "source": "datadog-agent",
      "severity": "critical",
      "custom_details": {
        "cluster": "prod-us-east-1",
        "error_rate": "7.4%"
      }
    }
  }'`}
                  </pre>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  2. Query Active Incidents (GET /api/incidents)
                </span>
                <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
                  <pre className="leading-relaxed">
                    {`curl -X GET "${baseUrl}/api/incidents?status=OPEN&limit=25" \\
  -H "Authorization: Bearer ${revealedSecret || 'ok_live_your_api_key'}"`}
                  </pre>
                </div>
              </div>
            </TabsContent>

            {/* Node.js Snippet */}
            <TabsContent value="node" className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  1. Trigger / Ingest Alert (POST /api/events)
                </span>
                <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
                  <pre className="leading-relaxed">
                    {`const response = await fetch('${baseUrl}/api/events', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${revealedSecret || 'ok_live_your_api_key'}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    event_action: 'trigger',
    dedup_key: 'api-gateway-5xx-spike',
    payload: {
      summary: '5xx Error Rate > 5% on Production API Gateway',
      source: 'datadog-agent',
      severity: 'critical',
      custom_details: {
        cluster: 'prod-us-east-1',
        error_rate: '7.4%',
      },
    },
  }),
});

const result = await response.json();
console.log(result);`}
                  </pre>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  2. Query Active Incidents (GET /api/incidents)
                </span>
                <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
                  <pre className="leading-relaxed">
                    {`const response = await fetch('${baseUrl}/api/incidents?status=OPEN&limit=25', {
  headers: {
    'Authorization': 'Bearer ${revealedSecret || 'ok_live_your_api_key'}',
  },
});

const data = await response.json();
console.log(data.incidents);`}
                  </pre>
                </div>
              </div>
            </TabsContent>

            {/* Python Snippet */}
            <TabsContent value="python" className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  1. Trigger / Ingest Alert (POST /api/events)
                </span>
                <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
                  <pre className="leading-relaxed">
                    {`import requests

response = requests.post(
    "${baseUrl}/api/events",
    headers={
        "Authorization": "Bearer ${revealedSecret || 'ok_live_your_api_key'}",
        "Content-Type": "application/json",
    },
    json={
        "event_action": "trigger",
        "dedup_key": "api-gateway-5xx-spike",
        "payload": {
            "summary": "5xx Error Rate > 5% on Production API Gateway",
            "source": "datadog-agent",
            "severity": "critical",
            "custom_details": {
                "cluster": "prod-us-east-1",
                "error_rate": "7.4%",
            },
        },
    },
)

print(response.json())`}
                  </pre>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  2. Query Active Incidents (GET /api/incidents)
                </span>
                <div className="relative rounded-xl bg-muted/40 border border-border/80 p-3.5 font-mono text-xs overflow-x-auto text-foreground">
                  <pre className="leading-relaxed">
                    {`import requests

response = requests.get(
    "${baseUrl}/api/incidents",
    headers={
        "Authorization": "Bearer ${revealedSecret || 'ok_live_your_api_key'}",
    },
    params={
        "status": "OPEN",
        "limit": 25,
    },
)

print(response.json()["incidents"])`}
                  </pre>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 5. Create API Key Modal Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent
          className="w-[calc(100%-2rem)] max-h-[90vh] overflow-x-hidden overflow-y-auto sm:w-[94vw]"
          style={{ maxWidth: '72rem' }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Key className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-bold">Generate New API Key</DialogTitle>
                <DialogDescription className="text-xs">
                  Create programmatic credentials to ingest events or query OpsKnight resources.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form action={formAction} className="space-y-5 pt-2">
            {state?.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              {/* Key Name */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-key-name" className="text-xs font-semibold">
                  Key Name / Client Identifier *
                </Label>
                <Input
                  id="modal-key-name"
                  name="name"
                  required
                  placeholder="e.g., Datadog Ingest or GitHub CI"
                  className="h-9 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Recognizable name for audit trails and rotation
                </p>
              </div>

              {/* Expiration */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-expiration-days" className="text-xs font-semibold">
                  Expiration Duration
                </Label>
                <select
                  id="modal-expiration-days"
                  name="expirationDays"
                  defaultValue="90"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="7">7 days (Short-lived test)</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days (Recommended)</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
                <p className="text-[10px] text-muted-foreground">
                  Key is automatically rejected after expiration
                </p>
              </div>
            </div>

            {/* Granular Permission Scopes */}
            <div className="space-y-2.5 rounded-xl border border-border/80 bg-muted/20 p-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <Label className="text-xs font-semibold">Granular Permission Scopes</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Selected: {selectedKeyScopes.size} of {visibleScopes.length} scopes (least privilege principle).
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyKeyPreset('ADMIN')}
                      className="h-7 text-[10px] px-2"
                    >
                      Admin Full
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyKeyPreset('RESPONDER')}
                    className="h-7 text-[10px] px-2"
                  >
                    Responder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyKeyPreset('READ_ONLY')}
                    className="h-7 text-[10px] px-2"
                  >
                    Read-Only
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => applyKeyPreset('CLEAR')}
                    className="h-7 text-[10px] px-2"
                  >
                    Clear
                  </Button>
                </div>
              </div>

              {/* Hidden inputs to guarantee all selected scopes are sent with formData */}
              {Array.from(selectedKeyScopes).map(sc => (
                <input key={sc} type="hidden" name="scopes" value={sc} />
              ))}

              <div className="grid min-w-0 gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
                {visibleScopes.map(scope => {
                  const Icon = scope.icon;
                  const isChecked = selectedKeyScopes.has(scope.value);
                  return (
                    <div
                      key={scope.value}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('button, input')) return;
                        setSelectedKeyScopes(prev => {
                          const next = new Set(prev);
                          if (next.has(scope.value)) next.delete(scope.value);
                          else next.add(scope.value);
                          return next;
                        });
                      }}
                      className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border p-3 text-xs cursor-pointer transition-all ${
                        isChecked
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border/80 bg-background hover:border-primary/40'
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        id={`scope-${scope.value}`}
                        className="mt-0.5 shrink-0"
                        onCheckedChange={checked => {
                          setSelectedKeyScopes(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(scope.value);
                            else next.delete(scope.value);
                            return next;
                          });
                        }}
                      />
                      <div className="grid min-w-0 cursor-pointer gap-1 sm:grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.4fr)_auto] sm:items-center">
                        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold leading-tight text-foreground">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 whitespace-normal break-normal">{scope.title}</span>
                        </span>
                        <span className="min-w-0 text-[11px] leading-relaxed text-muted-foreground">
                          {scope.detail}
                        </span>
                        <code className="max-w-full justify-self-start whitespace-nowrap rounded border border-border/50 bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:justify-self-end">
                          {scope.value}
                        </code>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog
        open={Boolean(revokeKeyId)}
        onOpenChange={open => {
          if (!open && !isRevoking) {
            setRevokeKeyId(null);
            setRevokeError(null);
          }
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any applications, webhooks, or pipelines using this token will immediately lose
              access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {revokeError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{revokeError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRevoking || !revokeKeyId}
              onClick={event => {
                event.preventDefault();
                if (revokeKeyId) {
                  void handleRevoke(revokeKeyId);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRevoking ? 'Revoking...' : 'Revoke Key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

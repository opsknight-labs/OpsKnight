'use client';

import { useActionState, useState, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { EmptyState } from './feedback/EmptyState';
import CopyButton from './CopyButton';
import ConfirmDialog from './ConfirmDialog';
import {
  Key,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Plus,
  Search,
  X,
  Code2,
  Clock,
  ShieldAlert,
  Send,
  Radio,
  FileText,
  Layers,
  Calendar,
} from 'lucide-react';

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

const SCOPES_CONFIG = [
  {
    value: 'events:write',
    title: 'Events Ingestion',
    detail: 'Send incoming alert payloads, webhooks, and telemetry',
    icon: Send,
    color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    defaultChecked: true,
  },
  {
    value: 'incidents:read',
    title: 'Incidents Read',
    detail: 'Query active and historical incident states and timelines',
    icon: FileText,
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    defaultChecked: true,
  },
  {
    value: 'incidents:write',
    title: 'Incidents Write',
    detail: 'Acknowledge, resolve, update severity, and add timeline notes',
    icon: Radio,
    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    defaultChecked: false,
  },
  {
    value: 'services:read',
    title: 'Services Read',
    detail: 'Query service catalog definitions and dependencies',
    icon: Layers,
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    defaultChecked: false,
  },
  {
    value: 'schedules:read',
    title: 'Schedules Read',
    detail: 'Query on-call rotations, active shifts, and responder escalation',
    icon: Calendar,
    color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    defaultChecked: false,
  },
];

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

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'>('ALL');

  const visibleScopes = canCreateWriteKeys
    ? SCOPES_CONFIG
    : SCOPES_CONFIG.filter(scope => !scope.value.endsWith(':write'));

  const handleRevoke = async (keyId: string) => {
    const formData = new FormData();
    formData.append('keyId', keyId);
    await revokeApiKey(formData);
    setRevokeKeyId(null);
    window.location.reload();
  };

  // Filtered keys
  const filteredKeys = useMemo(() => {
    return keys.filter(key => {
      const isRevoked = Boolean(key.revokedAt);
      const isExpired = Boolean(key.expired);
      const isActive = !isRevoked && !isExpired;

      const matchesSearch =
        searchQuery === '' ||
        key.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        key.prefix.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (key.ownerEmail && key.ownerEmail.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && isActive) ||
        (statusFilter === 'REVOKED' && isRevoked) ||
        (statusFilter === 'EXPIRED' && isExpired);

      return matchesSearch && matchesStatus;
    });
  }, [keys, searchQuery, statusFilter]);

  return (
    <div className="space-y-6">
      {/* 1. Reveal Token Banner / Modal if just created */}
      {state?.token && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-4 shadow-sm animate-in fade-in-0 duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>API Key Generated Successfully</span>
            </div>
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider"
            >
              Secret Token
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Please copy this key now and store it in a secure password manager or CI/CD secret
            vault. For security reasons,{' '}
            <strong className="text-foreground">
              you will not be able to view this token again
            </strong>
            .
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-emerald-500/25 bg-background p-2.5 shadow-2xs">
            <code className="flex-1 text-xs font-mono font-bold text-foreground break-all px-2 select-all">
              {state.token}
            </code>
            <CopyButton text={state.token} />
          </div>
        </div>
      )}

      {/* 2. Action and Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          {/* Search Bar */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, prefix, or owner..."
              className="pl-9 h-9 text-xs bg-background"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={v => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="h-9 text-xs w-[140px] bg-background">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="ACTIVE">Active Only</SelectItem>
              <SelectItem value="REVOKED">Revoked</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
            </SelectContent>
          </Select>
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
          title={
            searchQuery || statusFilter !== 'ALL'
              ? 'No matching API keys'
              : 'No API keys configured'
          }
          description={
            searchQuery || statusFilter !== 'ALL'
              ? 'Try adjusting your search terms or status filters.'
              : 'Generate your first API key above to enable webhook alert ingestion, CI/CD automation, and incident management.'
          }
          action={
            searchQuery || statusFilter !== 'ALL' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                }}
              >
                Reset Filters
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
                  {filteredKeys.length} {filteredKeys.length === 1 ? 'key' : 'keys'} in view
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
                    {`curl -X POST https://api.opsknight.com/api/events \\
  -H "Authorization: Bearer ${state?.token || 'ok_live_your_api_key'}" \\
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
                    {`curl -X GET "https://api.opsknight.com/api/incidents?status=OPEN&limit=25" \\
  -H "Authorization: Bearer ${state?.token || 'ok_live_your_api_key'}"`}
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
                    {`const response = await fetch('https://api.opsknight.com/api/events', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${state?.token || 'ok_live_your_api_key'}',
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
                    {`const response = await fetch('https://api.opsknight.com/api/incidents?status=OPEN&limit=25', {
  headers: {
    'Authorization': 'Bearer ${state?.token || 'ok_live_your_api_key'}',
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
    "https://api.opsknight.com/api/events",
    headers={
        "Authorization": "Bearer ${state?.token || 'ok_live_your_api_key'}",
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
    "https://api.opsknight.com/api/incidents",
    headers={
        "Authorization": "Bearer ${state?.token || 'ok_live_your_api_key'}",
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">Generate New API Key</DialogTitle>
                <DialogDescription className="text-xs">
                  Create programmatic credentials to ingest events or query OpsKnight resources.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            action={formData => {
              formAction(formData);
              setCreateDialogOpen(false);
            }}
            className="space-y-5 pt-2"
          >
            {state?.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
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
              <div>
                <Label className="text-xs font-semibold">Granular Permission Scopes</Label>
                <p className="text-[11px] text-muted-foreground">
                  Select only the scopes required for this automation (least privilege principle).
                </p>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {visibleScopes.map(scope => {
                  const Icon = scope.icon;
                  return (
                    <div
                      key={scope.value}
                      className="flex items-start gap-2.5 rounded-xl border border-border/80 bg-background p-3 hover:border-primary/40 hover:bg-accent/30 transition-all text-xs"
                    >
                      <Checkbox
                        name="scopes"
                        value={scope.value}
                        defaultChecked={scope.defaultChecked}
                        id={`scope-${scope.value}`}
                        className="mt-0.5"
                      />
                      <div className="flex-1 space-y-1">
                        <label
                          htmlFor={`scope-${scope.value}`}
                          className="text-xs font-semibold leading-none cursor-pointer flex items-center justify-between"
                        >
                          <span className="flex items-center gap-1.5 text-foreground">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            {scope.title}
                          </span>
                          <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono border border-border/50">
                            {scope.value}
                          </code>
                        </label>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {scope.detail}
                        </p>
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
      {revokeKeyId && (
        <ConfirmDialog
          open={true}
          title="Revoke API Key?"
          message="Are you sure you want to revoke this API key? Any applications, webhooks, or pipelines using this token will immediately lose access."
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

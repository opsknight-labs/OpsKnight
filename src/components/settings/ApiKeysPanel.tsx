'use client';

import { useState } from 'react';
import { useSecretSafeAction } from './useSecretSafeAction';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createApiKey, revokeApiKey } from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
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
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import DeveloperQuickstartCard from './DeveloperQuickstartCard';
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
import ScopeSelectorGrouped from './ScopeSelectorGrouped';
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [state, formAction] = useSecretSafeAction<State>(
    createApiKey,
    { error: null, success: false, token: null },
    setRevealedSecret,
    // Close the dialog from the action result instead of syncing state in an effect.
    result => {
      if (result.success) setCreateDialogOpen(false);
    }
  );

  const router = useRouter();
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

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

      {/* 4. Developer Quickstart Guide & Interactive Code Examples */}
      <DeveloperQuickstartCard appUrl={baseUrl} revealedSecret={revealedSecret} />

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

            {/* Granular Permission Scopes - Grouped by Domain Category with Search and Posture Badges */}
            <ScopeSelectorGrouped
              availableScopes={visibleScopes}
              selectedScopes={selectedKeyScopes}
              onChange={setSelectedKeyScopes}
              isAdmin={isAdmin}
              name="scopes"
            />

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

'use client';

import { ALL_API_SCOPE_DEFINITIONS, issuableScopesForRole } from '@/lib/api-scope-registry';
import { useState, useMemo, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  createServiceAccountAction,
  issueServiceAccountTokenAction,
  deleteServiceAccountAction,
  revokeServiceAccountTokenAction,
} from '@/app/(app)/settings/actions';
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
import { Card } from '@/components/ui/shadcn/card';
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
import CopyButton from './CopyButton';
import {
  Bot,
  Key,
  Plus,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  Search,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';

export type ServiceAccountToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
};

export type ServiceAccountItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  teams: { id: string; name: string }[];
  activeTokensCount: number;
  tokens: ServiceAccountToken[];
};

/**
 * Every scope currently enforced by the REST v2 surface, derived from the shared registry so
 * the UI, issuance validation and documentation cannot drift. Reserved scopes are not offered.
 */
export const ALL_V2_SCOPES = ALL_API_SCOPE_DEFINITIONS.filter(
  definition => definition.status === 'active'
).map(definition => ({
  value: definition.scope as string,
  title: definition.title,
  category: definition.category,
  write: definition.write,
}));

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm" className="gap-1.5">
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

export default function ServiceAccountsPanel({
  serviceAccounts,
  availableTeams,
  isAdmin,
}: {
  serviceAccounts: ServiceAccountItem[];
  availableTeams: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // Create Service Account Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createState, createAction] = useActionState(createServiceAccountAction, {
    error: null,
    success: false,
    token: null,
  });

  // Issue Token Dialog
  const [issueTokenTargetId, setIssueTokenTargetId] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState('90');
  // Only offer scopes the target account's role may hold; the server enforces the same rule.
  const issueTarget = serviceAccounts.find(sa => sa.id === issueTokenTargetId) ?? null;
  const offeredScopes = useMemo(() => {
    if (!issueTarget) return ALL_V2_SCOPES;
    const allowed = new Set<string>(issuableScopesForRole(issueTarget.role).map(d => d.scope));
    return ALL_V2_SCOPES.filter(scope => allowed.has(scope.value));
  }, [issueTarget]);
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    new Set(['events:write', 'incidents:read'])
  );
  const [issueTokenState, issueTokenAction] = useActionState(issueServiceAccountTokenAction, {
    error: null,
    success: false,
    token: null,
  });

  // Reveal Token Banner
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  useEffect(() => {
    if (createState?.success) {
      setCreateDialogOpen(false);
      router.refresh();
    }
  }, [createState?.success, router]);

  useEffect(() => {
    if (issueTokenState?.success && issueTokenState?.token) {
      setIssueTokenTargetId(null);
      setRevealedToken(issueTokenState.token);
      router.refresh();
    }
  }, [issueTokenState?.success, issueTokenState?.token, router]);

  // Delete SA Confirmation
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Revoke Token Confirmation
  const [revokeTokenData, setRevokeTokenData] = useState<{
    serviceAccountId: string;
    tokenId: string;
    tokenName: string;
  } | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAccounts = useMemo(() => {
    return serviceAccounts.filter(sa => {
      const matchesSearch =
        searchQuery === '' ||
        sa.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sa.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === 'ALL' || sa.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [serviceAccounts, searchQuery, roleFilter]);

  const handleDeleteAccount = async () => {
    if (!deleteAccountId) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const formData = new FormData();
      formData.append('serviceAccountId', deleteAccountId);
      await deleteServiceAccountAction(formData);
      setDeleteAccountId(null);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete service account.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!revokeTokenData) return;
    setIsRevoking(true);
    setRevokeError(null);
    try {
      const formData = new FormData();
      formData.append('serviceAccountId', revokeTokenData.serviceAccountId);
      formData.append('tokenId', revokeTokenData.tokenId);
      await revokeServiceAccountTokenAction(formData);
      setRevokeTokenData(null);
      router.refresh();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Failed to revoke token.');
    } finally {
      setIsRevoking(false);
    }
  };

  const applyPreset = (type: 'ADMIN' | 'RESPONDER' | 'READ_ONLY' | 'CLEAR') => {
    if (type === 'CLEAR') {
      setSelectedScopes(new Set());
    } else if (type === 'ADMIN') {
      setSelectedScopes(new Set(offeredScopes.map(s => s.value)));
    } else if (type === 'RESPONDER') {
      const offered = new Set(offeredScopes.map(s => s.value));
      setSelectedScopes(
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
          ].filter(value => offered.has(value))
        )
      );
    } else if (type === 'READ_ONLY') {
      setSelectedScopes(new Set(offeredScopes.filter(s => !s.write).map(s => s.value)));
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Revealed Secret Token Banner */}
      {(issueTokenState?.token || revealedToken) && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-4 shadow-sm animate-in fade-in-0 duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>Service Account Access Token Issued</span>
            </div>
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider"
            >
              Machine Token
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Please copy this secret token immediately. It allows programmatic access to OpsKnight REST API v2 on behalf of this service account. For security reasons,{' '}
            <strong className="text-foreground">it will never be displayed again</strong>.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-xl border border-emerald-500/25 bg-background p-2.5 shadow-2xs">
            <code className="flex-1 text-xs font-mono font-bold text-foreground break-all px-2 select-all">
              {issueTokenState?.token || revealedToken}
            </code>
            <CopyButton text={(issueTokenState?.token || revealedToken)!} />
          </div>
        </div>
      )}

      {/* 2. Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 bg-card border border-border/80 p-3.5 rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search service accounts by name or email..."
              className="h-9 text-xs pl-8 bg-background"
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

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-9 text-xs w-[140px] bg-background">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Roles</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
              <SelectItem value="RESPONDER">Responder</SelectItem>
              <SelectItem value="USER">User (Scoped)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isAdmin && (
          <Button
            onClick={() => setCreateDialogOpen(true)}
            size="sm"
            className="gap-1.5 shrink-0 h-9"
          >
            <Plus className="h-4 w-4" />
            New Service Account
          </Button>
        )}
      </div>

      {/* 3. Service Accounts List */}
      {filteredAccounts.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={searchQuery || roleFilter !== 'ALL' ? 'No matching service accounts' : 'No service accounts configured'}
          description={
            searchQuery || roleFilter !== 'ALL'
              ? 'Try adjusting your search query or role filters.'
              : 'Service accounts provide non-human machine identities with granular RBAC and scoped API access for Kubernetes, Terraform, and CI/CD pipelines.'
          }
          action={
            isAdmin && !searchQuery && roleFilter === 'ALL' ? (
              <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create Service Account
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredAccounts.map(sa => {
            const isExpanded = expandedAccounts.has(sa.id);
            return (
              <Card key={sa.id} className="border-border/80 shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0 mt-0.5">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">{sa.name}</span>
                        <Badge
                          variant="outline"
                          className={
                            sa.role === 'ADMIN'
                              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 text-[10px]'
                              : sa.role === 'RESPONDER'
                              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 text-[10px]'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]'
                          }
                        >
                          {sa.role}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            sa.status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]'
                              : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20 text-[10px]'
                          }
                        >
                          {sa.status}
                        </Badge>
                      </div>

                      <p className="text-xs font-mono text-muted-foreground truncate">{sa.email}</p>

                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap pt-0.5">
                        <span>Created {sa.createdAt}</span>
                        <span>•</span>
                        <span>{sa.activeTokensCount} active {sa.activeTokensCount === 1 ? 'token' : 'tokens'}</span>
                        {sa.teams.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {sa.teams.map(t => t.name).join(', ')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleExpand(sa.id)}
                      className="h-8 text-xs gap-1"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Hide Tokens ({sa.tokens.length})
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3.5 w-3.5" />
                          View Tokens ({sa.tokens.length})
                        </>
                      )}
                    </Button>

                    {isAdmin && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setIssueTokenTargetId(sa.id);
                            applyPreset('RESPONDER');
                          }}
                          className="h-8 text-xs gap-1"
                        >
                          <Key className="h-3.5 w-3.5" />
                          Issue Token
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${sa.name}`}
                          onClick={() => setDeleteAccountId(sa.id)}
                          className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded Tokens Sub-Table */}
                {isExpanded && (
                  <div className="border-t border-border/60 bg-muted/20 p-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Active Machine Tokens ({sa.tokens.length})
                      </span>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIssueTokenTargetId(sa.id);
                            applyPreset('RESPONDER');
                          }}
                          className="h-7 text-[11px] gap-1"
                        >
                          <Plus className="h-3 w-3" />
                          Issue Token
                        </Button>
                      )}
                    </div>

                    {sa.tokens.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-2">
                        No active tokens issued for this service account. Click &apos;Issue Token&apos; to generate one.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-border/70 bg-background">
                        <Table>
                          <TableHeader className="bg-muted/40">
                            <TableRow className="border-border/60">
                              <TableHead className="text-xs py-2.5">Token Name</TableHead>
                              <TableHead className="text-xs py-2.5">Prefix</TableHead>
                              <TableHead className="text-xs py-2.5">Scopes</TableHead>
                              <TableHead className="text-xs py-2.5">Created</TableHead>
                              <TableHead className="text-xs py-2.5">Expires</TableHead>
                              <TableHead className="text-xs py-2.5 text-right">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sa.tokens.map(token => (
                              <TableRow key={token.id} className="border-border/60">
                                <TableCell className="text-xs font-semibold py-2.5">
                                  {token.name}
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <code className="text-xs font-mono font-semibold bg-muted px-2 py-0.5 rounded border border-border/60">
                                    {token.prefix}...
                                  </code>
                                </TableCell>
                                <TableCell className="py-2.5">
                                  <div className="flex flex-wrap gap-1 max-w-sm">
                                    {token.scopes.map(sc => (
                                      <Badge
                                        key={sc}
                                        variant="outline"
                                        className="text-[10px] px-1.5 py-0 bg-background font-mono border-border/80"
                                      >
                                        {sc}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground py-2.5">
                                  {token.createdAt}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground py-2.5">
                                  {token.expiresAt || 'Never'}
                                </TableCell>
                                <TableCell className="text-right py-2.5">
                                  {isAdmin && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        setRevokeTokenData({
                                          serviceAccountId: sa.id,
                                          tokenId: token.id,
                                          tokenName: token.name,
                                        })
                                      }
                                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs font-semibold"
                                    >
                                      Revoke
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 4. Create Service Account Modal */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">Create Service Account</DialogTitle>
                <DialogDescription className="text-xs">
                  Create a dedicated machine identity for automation, Terraform, and CI/CD pipelines.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form action={createAction} className="space-y-4 pt-2">
            {createState?.error && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>{createState.error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="sa-name" className="text-xs font-semibold">
                Account Name *
              </Label>
              <Input
                id="sa-name"
                name="name"
                required
                placeholder="e.g., CI/CD GitHub Runner or Terraform Operator"
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-role" className="text-xs font-semibold">
                Authorization Role
              </Label>
              <select
                id="sa-role"
                name="role"
                defaultValue="RESPONDER"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="RESPONDER">Responder (Can manage & acknowledge incidents)</option>
                <option value="USER">User (Resource-scoped access to assigned teams)</option>
                <option value="ADMIN">Admin (Full administrative privileges)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-desc" className="text-xs font-semibold">
                Description / Purpose
              </Label>
              <Input
                id="sa-desc"
                name="description"
                placeholder="e.g., Deploys infrastructure and executes automated runbooks"
                className="h-9 text-xs"
              />
            </div>

            {availableTeams.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Assign Teams (Resource Scoping)</Label>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-border/80 bg-muted/20 p-2.5 space-y-1.5">
                  {availableTeams.map(t => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        name="teamIds"
                        value={t.id}
                        className="rounded border-input text-primary"
                      />
                      <span>{t.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <SubmitButton label="Create Account" pendingLabel="Creating..." />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 5. Issue Service Account Token Modal */}
      <Dialog
        open={Boolean(issueTokenTargetId)}
        onOpenChange={open => {
          if (!open) setIssueTokenTargetId(null);
        }}
      >
        <DialogContent
          className="w-[calc(100%-2rem)] max-h-[90vh] overflow-x-hidden overflow-y-auto sm:w-[94vw]"
          style={{ maxWidth: '72rem' }}
        >
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">Issue Service Account Token</DialogTitle>
                <DialogDescription className="text-xs">
                  Generate a scoped Bearer token for automated API calls.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form
            action={formData => {
              // Never submit a scope that is not offered for this account's role.
              const offered = new Set(offeredScopes.map(scope => scope.value));
              for (const sc of selectedScopes) {
                if (offered.has(sc)) formData.append('scopes', sc);
              }
              issueTokenAction(formData);
            }}
            className="space-y-4 pt-2"
          >
            <input type="hidden" name="serviceAccountId" value={issueTokenTargetId || ''} />

            {issueTokenState?.error && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>{issueTokenState.error}</AlertDescription>
              </Alert>
            )}

            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="token-name" className="text-xs font-semibold">
                  Token Name / Label *
                </Label>
                <Input
                  id="token-name"
                  name="name"
                  required
                  placeholder="e.g., Production Deploy Runner"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="token-expiry" className="text-xs font-semibold">
                  Expiration Duration
                </Label>
                <select
                  id="token-expiry"
                  name="expirationDays"
                  value={tokenExpiry}
                  onChange={event => setTokenExpiry(event.target.value)}
                  aria-describedby={tokenExpiry === '0' ? 'token-expiry-warning' : undefined}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days (Recommended)</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                  <option value="0">Never expires (security exception)</option>
                </select>
                {tokenExpiry === '0' && (
                  <p
                    id="token-expiry-warning"
                    role="note"
                    className="text-[11px] text-amber-700 dark:text-amber-400"
                  >
                    This token stays valid until you revoke it. Use it only when rotation is not
                    possible, and record who owns it.
                  </p>
                )}
              </div>
            </div>

            {/* Scope Presets */}
            <div className="space-y-2.5 rounded-xl border border-border/80 bg-muted/20 p-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <Label className="text-xs font-semibold">Granular Permission Scopes</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Selected: {offeredScopes.filter(scope => selectedScopes.has(scope.value)).length} of {offeredScopes.length} scopes
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('ADMIN')}
                    className="h-7 text-[10px] px-2"
                  >
                    Admin Full
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('RESPONDER')}
                    className="h-7 text-[10px] px-2"
                  >
                    Responder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset('READ_ONLY')}
                    className="h-7 text-[10px] px-2"
                  >
                    Read-Only
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => applyPreset('CLEAR')}
                    className="h-7 text-[10px] px-2"
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-72 overflow-y-auto pr-1">
                {offeredScopes.map(scope => {
                  const isChecked = selectedScopes.has(scope.value);
                  return (
                    <div
                      key={scope.value}
                      onClick={e => {
                        if ((e.target as HTMLElement).closest('button, input')) return;
                        setSelectedScopes(prev => {
                          const next = new Set(prev);
                          if (next.has(scope.value)) next.delete(scope.value);
                          else next.add(scope.value);
                          return next;
                        });
                      }}
                      className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-all ${
                        isChecked
                          ? 'border-primary/50 bg-primary/5 font-medium'
                          : 'border-border/60 bg-background text-muted-foreground hover:border-border'
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        id={`sc-${scope.value}`}
                        className="mt-0.5"
                        onCheckedChange={checked => {
                          setSelectedScopes(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(scope.value);
                            else next.delete(scope.value);
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0">
                        <span className="block text-[11px] font-semibold text-foreground truncate">
                          {scope.title}
                        </span>
                        <code className="text-[10px] font-mono text-muted-foreground">
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
                onClick={() => setIssueTokenTargetId(null)}
              >
                Cancel
              </Button>
              <SubmitButton label="Issue Token" pendingLabel="Issuing..." />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 6. Delete Service Account Alert Dialog */}
      <AlertDialog
        open={Boolean(deleteAccountId)}
        onOpenChange={open => {
          if (!open && !isDeleting) setDeleteAccountId(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the service account and permanently revoke all of its issued tokens. Any running automation using these credentials will immediately fail.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting || !deleteAccountId}
              onClick={e => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 7. Revoke Token Alert Dialog */}
      <AlertDialog
        open={Boolean(revokeTokenData)}
        onOpenChange={open => {
          if (!open && !isRevoking) setRevokeTokenData(null);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Access Token?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke &apos;{revokeTokenData?.tokenName}&apos;? Applications using this Bearer token will immediately lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {revokeError && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>{revokeError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRevoking || !revokeTokenData}
              onClick={e => {
                e.preventDefault();
                void handleRevokeToken();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? 'Revoking...' : 'Revoke Token'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

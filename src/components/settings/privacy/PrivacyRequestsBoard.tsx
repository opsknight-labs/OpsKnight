'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Download,
  FileArchive,
  Loader2,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-product-notification';
import PrivacyRequestDetailDialog from './PrivacyRequestDetailDialog';
import { PRIVACY_REQUEST_TRANSITIONS } from '@/lib/privacy/state-machine';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Textarea } from '@/components/ui/shadcn/textarea';

type PrivacyRequestType =
  | 'ACCESS'
  | 'RECTIFICATION'
  | 'ERASURE'
  | 'RESTRICTION'
  | 'OBJECTION'
  | 'PORTABILITY';

type PrivacyRequestStatus =
  | 'RECEIVED'
  | 'IDENTITY_VERIFICATION'
  | 'IN_REVIEW'
  | 'PROCESSING'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'REJECTED';

type RequestUser = { id: string; name: string; email: string };

export type PrivacyRequestRow = {
  id: string;
  subjectType: 'USER' | 'STATUS_SUBSCRIBER';
  subjectId: string;
  requestType: PrivacyRequestType;
  status: PrivacyRequestStatus;
  requestedAt: string | Date;
  verifiedAt: string | Date | null;
  notes: string | null;
  rejectionReason: string | null;
  requestedBy: RequestUser | null;
  assignedTo: RequestUser | null;
};

const AUTOMATED_TYPES: readonly PrivacyRequestType[] = ['ACCESS', 'PORTABILITY', 'ERASURE'];

/** Only USER subjects are automated in Phase 2 — matches generateSubjectExport()'s own guard. */
export function isAutomatedRequest(
  request: Pick<PrivacyRequestRow, 'subjectType' | 'requestType'>
): boolean {
  return request.subjectType === 'USER' && AUTOMATED_TYPES.includes(request.requestType);
}

const STATUS_BADGE_CLASS: Record<PrivacyRequestStatus, string> = {
  RECEIVED: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  IDENTITY_VERIFICATION: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  IN_REVIEW: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PROCESSING: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  BLOCKED: 'border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  COMPLETED: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function PrivacyRequestsBoard({
  initialRequests,
  initialNextCursor,
  assignableUsers,
  subjectUsers,
  canManage,
  canExport,
  canErase,
}: {
  initialRequests: PrivacyRequestRow[];
  initialNextCursor: string | null;
  assignableUsers: RequestUser[];
  subjectUsers: RequestUser[];
  canManage: boolean;
  canExport: boolean;
  canErase: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [requests, setRequests] = useState(initialRequests);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [createOpen, setCreateOpen] = useState(false);
  const [subjectType, setSubjectType] = useState<'USER' | 'STATUS_SUBSCRIBER'>('USER');
  const [subjectId, setSubjectId] = useState('');
  const [subjectQuery, setSubjectQuery] = useState('');
  const [subjectMatches, setSubjectMatches] = useState(subjectUsers);
  const [requestType, setRequestType] = useState<PrivacyRequestType>('ACCESS');
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | PrivacyRequestStatus>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | PrivacyRequestType>('ALL');
  const [rejectModalReq, setRejectModalReq] = useState<{ id: string; subject: string } | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState('');

  const subjectUserMap = useMemo(() => {
    const map = new Map<string, RequestUser>();
    for (const u of subjectUsers) {
      map.set(u.id, u);
    }
    for (const u of subjectMatches) {
      map.set(u.id, u);
    }
    return map;
  }, [subjectUsers, subjectMatches]);

  useEffect(() => {
    setRequests(initialRequests);
    setNextCursor(initialNextCursor);
  }, [initialRequests, initialNextCursor]);

  useEffect(() => {
    if (subjectType !== 'USER' || subjectQuery.trim().length < 2) {
      setSubjectMatches(subjectUsers);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/compliance/privacy-requests/subjects?search=${encodeURIComponent(subjectQuery.trim())}`,
        { cache: 'no-store' }
      )
        .then(readJson)
        .then(body => setSubjectMatches((body?.data?.users as RequestUser[]) ?? []));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [subjectQuery, subjectType, subjectUsers]);

  const openCount = useMemo(
    () => requests.filter(r => r.status !== 'COMPLETED' && r.status !== 'REJECTED').length,
    [requests]
  );

  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      if (statusFilter === 'OPEN') {
        if (req.status === 'COMPLETED' || req.status === 'REJECTED') return false;
      } else if (statusFilter !== 'ALL') {
        if (req.status !== statusFilter) return false;
      }
      if (typeFilter !== 'ALL') {
        if (req.requestType !== typeFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const user = subjectUserMap.get(req.subjectId);
        const matchesId = req.subjectId.toLowerCase().includes(q);
        const matchesType = req.requestType.toLowerCase().includes(q);
        const matchesStatus = req.status.toLowerCase().includes(q);
        const matchesName = user?.name?.toLowerCase().includes(q);
        const matchesEmail = user?.email?.toLowerCase().includes(q);
        if (!matchesId && !matchesType && !matchesStatus && !matchesName && !matchesEmail) {
          return false;
        }
      }
      return true;
    });
  }, [requests, statusFilter, typeFilter, searchQuery, subjectUserMap]);

  function loadMore() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/compliance/privacy-requests?cursor=${encodeURIComponent(nextCursor)}`,
          { cache: 'no-store' }
        );
        const body = await readJson(response);
        if (!response.ok) {
          showToast(body?.error ?? 'Failed to load more requests.', 'error');
          return;
        }
        setRequests(prev => [...prev, ...(body.data.requests as PrivacyRequestRow[])]);
        setNextCursor(body.data.nextCursor ?? null);
      } finally {
        setIsLoadingMore(false);
      }
    })();
  }

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subjectId.trim()) {
      showToast('Subject ID is required.', 'error');
      return;
    }
    startTransition(async () => {
      const response = await fetch('/api/compliance/privacy-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectType,
          subjectId: subjectId.trim(),
          requestType,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        showToast(body?.error ?? 'Failed to create privacy request.', 'error');
        return;
      }
      showToast('Privacy request created.', 'success');
      setCreateOpen(false);
      setSubjectId('');
      setNotes('');
      setRequestType('ACCESS');
      router.refresh();
    });
  }

  function transition(requestId: string, toStatus: PrivacyRequestStatus, rejectionReason?: string) {
    startTransition(async () => {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus, rejectionReason }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        showToast(body?.error ?? 'Failed to update request status.', 'error');
        return;
      }
      showToast('Request status updated.', 'success');
      router.refresh();
    });
  }

  function assign(requestId: string, assignedToId: string | null) {
    startTransition(async () => {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedToId }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        showToast(body?.error ?? 'Failed to assign request.', 'error');
        return;
      }
      showToast('Request reassigned.', 'success');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {requests.length} total request{requests.length === 1 ? '' : 's'} · {openCount} open
          </p>
          {canManage && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New request
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleCreate} className="space-y-4">
                  <DialogHeader>
                    <DialogTitle>New privacy request</DialogTitle>
                    <DialogDescription>
                      This does not erase, export, or change any data. It only starts tracking the
                      request. Identify the subject precisely; the subject cannot be changed later.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-2">
                    <Label>Subject type</Label>
                    <Select
                      value={subjectType}
                      onValueChange={v => {
                        setSubjectType(v as typeof subjectType);
                        setSubjectId('');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USER">User</SelectItem>
                        <SelectItem value="STATUS_SUBSCRIBER">Status page subscriber</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subjectId">Subject</Label>
                    {subjectType === 'USER' ? (
                      <div className="space-y-2">
                        <Input
                          value={subjectQuery}
                          onChange={event => setSubjectQuery(event.target.value)}
                          placeholder="Search all active users by name or email…"
                          aria-label="Search privacy request subjects"
                        />
                        <Select value={subjectId} onValueChange={setSubjectId}>
                          <SelectTrigger aria-label="Select privacy request subject">
                            <SelectValue placeholder="Select subject" />
                          </SelectTrigger>
                          <SelectContent>
                            {subjectMatches.map(user => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.name || user.email} · {user.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <Input
                        id="subjectId"
                        value={subjectId}
                        onChange={e => setSubjectId(e.target.value)}
                        placeholder="cuid of the status page subscriber"
                        required
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Request type</Label>
                    <Select
                      value={requestType}
                      onValueChange={v => setRequestType(v as PrivacyRequestType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          [
                            'ACCESS',
                            'PORTABILITY',
                            'RECTIFICATION',
                            'ERASURE',
                            'RESTRICTION',
                            'OBJECTION',
                          ] as PrivacyRequestType[]
                        ).map(type => (
                          <SelectItem key={type} value={type}>
                            {type}
                            {!isAutomatedRequest({ subjectType, requestType: type })
                              ? ' — not yet automated'
                              : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isAutomatedRequest({ subjectType, requestType }) && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {subjectType === 'STATUS_SUBSCRIBER'
                          ? 'Status-page subscriber export is not yet automated; this request requires manual review.'
                          : 'This request type requires manual review; OpsKnight does not automate it yet.'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Internal notes (optional)</Label>
                    <Textarea
                      id="notes"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <DialogFooter>
                    <Button type="submit" disabled={isPending}>
                      {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      Create request
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Search & Filters Toolbar */}
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, or ID…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-9 pl-9 pr-8 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select
              value={statusFilter}
              onValueChange={v => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="h-9 w-40 text-xs">
                <SelectValue placeholder="Status: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="OPEN">Open only ({openCount})</SelectItem>
                <SelectItem value="RECEIVED">Received</SelectItem>
                <SelectItem value="IDENTITY_VERIFICATION">Identity Verification</SelectItem>
                <SelectItem value="IN_REVIEW">In Review</SelectItem>
                <SelectItem value="PROCESSING">Processing</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={v => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger className="h-9 w-36 text-xs">
                <SelectValue placeholder="Type: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                <SelectItem value="ERASURE">Erasure</SelectItem>
                <SelectItem value="ACCESS">Access</SelectItem>
                <SelectItem value="PORTABILITY">Portability</SelectItem>
                <SelectItem value="RECTIFICATION">Rectification</SelectItem>
                <SelectItem value="RESTRICTION">Restriction</SelectItem>
                <SelectItem value="OBJECTION">Objection</SelectItem>
              </SelectContent>
            </Select>
            {(searchQuery || statusFilter !== 'ALL' || typeFilter !== 'ALL') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                  setTypeFilter('ALL');
                }}
              >
                Reset filters
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {filteredRequests.length} of {requests.length} request
            {requests.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Details & Plan</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {requests.length === 0
                      ? 'No privacy requests yet.'
                      : 'No privacy requests matching current filters.'}
                  </TableCell>
                </TableRow>
              )}
              {filteredRequests.map(req => {
                const nextStatuses = PRIVACY_REQUEST_TRANSITIONS[req.status];
                const isTerminal = nextStatuses.length === 0;
                const automated = isAutomatedRequest(req);
                const subjectUser =
                  req.subjectType === 'USER' ? subjectUserMap.get(req.subjectId) : null;
                return (
                  <TableRow key={req.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {subjectUser ? (
                          <>
                            <span className="text-sm font-medium text-foreground">
                              {subjectUser.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {subjectUser.email}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground/70">
                              ID: {req.subjectId}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-xs font-medium">
                            {req.subjectType}: {req.subjectId}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          {req.requestType === 'ERASURE' && (
                            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                          )}
                          {req.requestType === 'ACCESS' && (
                            <FileArchive className="h-3.5 w-3.5 text-blue-500" />
                          )}
                          {req.requestType === 'PORTABILITY' && (
                            <Download className="h-3.5 w-3.5 text-indigo-500" />
                          )}
                          <span>{req.requestType}</span>
                        </div>
                        {!automated && (
                          <Badge
                            variant="outline"
                            className="w-fit border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                          >
                            Requires manual review
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`${STATUS_BADGE_CLASS[req.status]} flex w-fit items-center gap-1 font-medium`}
                      >
                        {req.status === 'COMPLETED' && <CheckCircle2 className="h-3 w-3" />}
                        {req.status === 'PROCESSING' && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {req.status === 'IDENTITY_VERIFICATION' && (
                          <ShieldAlert className="h-3 w-3" />
                        )}
                        {req.status === 'REJECTED' && <XCircle className="h-3 w-3" />}
                        {req.status.replaceAll('_', ' ')}
                      </Badge>
                      {req.verifiedAt && req.status !== 'COMPLETED' && (
                        <span className="mt-0.5 block text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          ✓ Identity verified
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Select
                          value={req.assignedTo?.id ?? 'unassigned'}
                          onValueChange={v => assign(req.id, v === 'unassigned' ? null : v)}
                          disabled={isPending}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {assignableUsers.map(user => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        (req.assignedTo?.name ?? '—')
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(req.requestedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <PrivacyRequestDetailDialog
                        requestId={req.id}
                        canManage={canManage}
                        canExport={canExport}
                        canErase={canErase}
                        automated={automated}
                        subjectUser={subjectUser ?? undefined}
                        trigger={
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 text-xs font-medium"
                          >
                            <FileArchive className="h-3.5 w-3.5" />
                            Manage
                          </Button>
                        }
                      />
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {isTerminal ? (
                          <span className="text-xs text-muted-foreground">Terminal</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            {nextStatuses
                              .filter(status => status !== 'REJECTED')
                              .filter(status => status !== 'PROCESSING' || Boolean(req.verifiedAt))
                              .map(status => {
                                const isProcessing = status === 'PROCESSING';
                                return (
                                  <Button
                                    key={status}
                                    size="sm"
                                    variant={isProcessing ? 'default' : 'secondary'}
                                    className="h-8 text-xs font-normal"
                                    disabled={isPending}
                                    onClick={() => transition(req.id, status)}
                                  >
                                    {isProcessing && <Play className="mr-1 h-3 w-3" />}
                                    {status.replaceAll('_', ' ')}
                                  </Button>
                                );
                              })}
                            {nextStatuses.includes('REJECTED') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                                disabled={isPending}
                                onClick={() =>
                                  setRejectModalReq({
                                    id: req.id,
                                    subject: `${req.subjectType}: ${req.subjectId}`,
                                  })
                                }
                              >
                                Reject…
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {nextCursor && (
          <div className="flex justify-center">
            <Button size="sm" variant="outline" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Load more
            </Button>
          </div>
        )}
      </CardContent>

      {/* Dedicated Rejection Dialog */}
      <Dialog
        open={Boolean(rejectModalReq)}
        onOpenChange={open => {
          if (!open) {
            setRejectModalReq(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Reject privacy request</DialogTitle>
            <DialogDescription>
              Please provide a clear reason for rejecting this privacy request for{' '}
              <span className="font-mono font-medium text-foreground">
                {rejectModalReq?.subject}
              </span>
              . This reason will be recorded on the request record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reject-modal-reason">Rejection reason</Label>
            <Textarea
              id="reject-modal-reason"
              placeholder="e.g. Identity could not be verified within statutory timeline..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectModalReq(null);
                setRejectReason('');
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || !rejectReason.trim()}
              onClick={() => {
                if (!rejectModalReq || !rejectReason.trim()) return;
                transition(rejectModalReq.id, 'REJECTED', rejectReason.trim());
                setRejectModalReq(null);
                setRejectReason('');
              }}
            >
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

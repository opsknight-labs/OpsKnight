'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileArchive, Loader2, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-product-notification';
import ResponderCombobox from '@/components/ResponderCombobox';
import PrivacyRequestDetailDialog from './PrivacyRequestDetailDialog';
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

const ALLOWED_TRANSITIONS: Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]> = {
  RECEIVED: ['IDENTITY_VERIFICATION', 'IN_REVIEW', 'REJECTED'],
  IDENTITY_VERIFICATION: ['IN_REVIEW', 'BLOCKED', 'REJECTED'],
  IN_REVIEW: ['PROCESSING', 'BLOCKED', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'BLOCKED', 'REJECTED'],
  BLOCKED: ['IN_REVIEW', 'PROCESSING', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

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
  const [requestType, setRequestType] = useState<PrivacyRequestType>('ACCESS');
  const [notes, setNotes] = useState('');
  const [rejectDrafts, setRejectDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setRequests(initialRequests);
    setNextCursor(initialNextCursor);
  }, [initialRequests, initialNextCursor]);

  const openCount = useMemo(
    () => requests.filter(r => r.status !== 'COMPLETED' && r.status !== 'REJECTED').length,
    [requests]
  );

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
                      <ResponderCombobox
                        users={subjectUsers}
                        selectedUserId={subjectId || undefined}
                        onSelect={setSubjectId}
                        label="Select subject"
                        placeholder="Search by name or email…"
                        emptyMessage="No matching users."
                        className="w-full justify-between"
                        ariaLabel="Select privacy request subject"
                      />
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

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Export</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 7 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No privacy requests yet.
                  </TableCell>
                </TableRow>
              )}
              {requests.map(req => {
                const nextStatuses = ALLOWED_TRANSITIONS[req.status];
                const isTerminal = nextStatuses.length === 0;
                const automated = isAutomatedRequest(req);
                return (
                  <TableRow key={req.id}>
                    <TableCell className="font-mono text-xs">
                      {req.subjectType}: {req.subjectId}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span>{req.requestType}</span>
                        {!automated && (
                          <Badge variant="outline" className="w-fit text-[10px]">
                            Requires manual review
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE_CLASS[req.status]}>
                        {req.status.replaceAll('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Select
                          value={req.assignedTo?.id ?? 'unassigned'}
                          onValueChange={v => assign(req.id, v === 'unassigned' ? null : v)}
                          disabled={isPending}
                        >
                          <SelectTrigger className="h-8 w-44">
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
                        trigger={
                          <Button size="sm" variant="outline">
                            <FileArchive className="mr-1.5 h-4 w-4" />
                            Manage
                          </Button>
                        }
                      />
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {isTerminal ? (
                          <span className="text-xs text-muted-foreground">No further action</span>
                        ) : (
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {nextStatuses
                                .filter(status => status !== 'REJECTED')
                                .map(status => (
                                  <Button
                                    key={status}
                                    size="sm"
                                    variant="secondary"
                                    disabled={isPending}
                                    onClick={() => transition(req.id, status)}
                                  >
                                    {status.replaceAll('_', ' ')}
                                  </Button>
                                ))}
                            </div>
                            {nextStatuses.includes('REJECTED') && (
                              <div className="flex items-center gap-1.5">
                                <Input
                                  placeholder="Rejection reason"
                                  className="h-8 w-40 text-xs"
                                  value={rejectDrafts[req.id] ?? ''}
                                  onChange={e =>
                                    setRejectDrafts(prev => ({ ...prev, [req.id]: e.target.value }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={isPending || !rejectDrafts[req.id]?.trim()}
                                  onClick={() =>
                                    transition(req.id, 'REJECTED', rejectDrafts[req.id]?.trim())
                                  }
                                >
                                  Reject
                                </Button>
                              </div>
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
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  Clock,
  Download,
  FileArchive,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';
import { notify } from '@/lib/toast';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { toneClasses } from '@/components/patterns';

type ExportArtifactStatus = 'PENDING' | 'READY' | 'DOWNLOADED' | 'EXPIRED' | 'FAILED';

type ExportArtifact = {
  id: string;
  status: ExportArtifactStatus;
  createdAt: string;
  expiresAt: string;
  downloadCount: number;
  sizeBytes: number | null;
  checksum: string | null;
  failureReason: string | null;
};

type RequestDetail = {
  id: string;
  subjectType: 'USER' | 'STATUS_SUBSCRIBER';
  subjectId: string;
  requestType: string;
  status: string;
  requestedAt: string;
  verifiedAt: string | null;
  verificationStatus: 'PENDING' | 'VERIFIED';
  verificationMethod: string | null;
  verificationReference: string | null;
  verifiedBy: { id: string; name: string | null; email: string } | null;
  assignedTo?: { id: string; name: string | null; email: string } | null;
  requestedBy?: { id: string; name: string | null; email: string } | null;
  notes: string | null;
  exportArtifacts: ExportArtifact[];
  erasureExecution: {
    id: string;
    status: 'PENDING' | 'RUNNING' | 'PARTIAL' | 'COMPLETED' | 'FAILED';
    planVersion: number;
    startedAt: string | null;
    completedAt: string | null;
    failureCode: string | null;
  } | null;
};

type ErasurePlanDomain = {
  id: string;
  label: string;
  strategy: 'DELETE' | 'ANONYMIZE' | 'DETACH' | 'PRESERVE' | 'REVIEW';
  blocking: boolean;
  count: number;
};

type ErasurePlan = {
  domains: ErasurePlanDomain[];
  blockingConditions: string[];
  canExecute: boolean;
};

const EXECUTION_BADGE_CLASS: Record<string, string> = {
  PENDING: toneClasses(null).soft,
  RUNNING: toneClasses('info').soft,
  PARTIAL: toneClasses('elevated').soft,
  COMPLETED: toneClasses('ok').soft,
  FAILED: toneClasses('critical').soft,
};

const ARTIFACT_BADGE_CLASS: Record<ExportArtifactStatus, string> = {
  PENDING: toneClasses(null).soft,
  READY: toneClasses('ok').soft,
  DOWNLOADED: toneClasses(null).soft,
  EXPIRED: toneClasses('elevated').soft,
  FAILED: toneClasses('critical').soft,
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  RECEIVED: toneClasses(null).soft,
  IDENTITY_VERIFICATION: toneClasses('info').soft,
  IN_REVIEW: toneClasses('elevated').soft,
  PROCESSING: toneClasses(null).soft,
  BLOCKED: toneClasses('elevated').soft,
  COMPLETED: toneClasses('ok').soft,
  REJECTED: toneClasses('critical').soft,
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units.at(unitIndex) ?? 'B'}`;
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function PrivacyRequestDetailDialog({
  requestId,
  canManage,
  canExport,
  canErase,
  automated,
  trigger,
  subjectUser,
}: {
  requestId: string;
  canManage: boolean;
  canExport: boolean;
  canErase: boolean;
  automated: boolean;
  trigger: React.ReactNode;
  subjectUser?: { id: string; name: string | null; email: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [plan, setPlan] = useState<ErasurePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const exportEligible = detail?.status === 'PROCESSING' && Boolean(detail.verifiedAt);

  const isRejected = detail?.status === 'REJECTED';
  const isBlocked = detail?.status === 'BLOCKED';
  const isCompleted = detail?.status === 'COMPLETED';
  const isProcessing = detail?.status === 'PROCESSING';

  const lifecycleSteps = detail
    ? [
        {
          id: 'received',
          label: 'Received',
          status: 'complete' as const,
          caption: new Date(detail.requestedAt).toLocaleDateString(),
        },
        {
          id: 'verified',
          label: 'Identity Verification',
          status: (detail.verifiedAt
            ? 'complete'
            : detail.status === 'IDENTITY_VERIFICATION'
              ? 'current'
              : 'upcoming') as 'complete' | 'current' | 'upcoming' | 'error',
          caption: detail.verifiedAt ? 'Verified' : 'Required',
        },
        {
          id: 'processing',
          label: 'Processing',
          status: (isCompleted
            ? 'complete'
            : isProcessing
              ? 'current'
              : isBlocked
                ? 'error'
                : isRejected
                  ? 'upcoming'
                  : 'upcoming') as 'complete' | 'current' | 'upcoming' | 'error',
          caption: isProcessing
            ? 'In progress'
            : isBlocked
              ? 'Blocked'
              : isCompleted
                ? 'Completed'
                : 'Pending',
        },
        {
          id: 'resolution',
          label: isRejected ? 'Rejected' : 'Completed',
          status: (isCompleted ? 'complete' : isRejected ? 'error' : 'upcoming') as
            'complete' | 'current' | 'upcoming' | 'error',
          caption: isCompleted ? 'Completed' : isRejected ? 'Rejected' : 'Terminal',
        },
      ]
    : [];

  async function loadDetail() {
    setLoading(true);
    try {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}`, {
        cache: 'no-store',
      });
      const body = await readJson(response);
      if (!response.ok) {
        notify.error(body?.error ?? 'Failed to load request detail.');
        return;
      }
      const nextDetail = body.data.request as RequestDetail;
      setDetail(nextDetail);
      if (nextDetail.requestType === 'ERASURE') {
        void loadPlan();
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadPlan() {
    setPlanLoading(true);
    try {
      const response = await fetch(
        `/api/compliance/privacy-requests/${requestId}/erasure/preview`,
        {
          cache: 'no-store',
        }
      );
      const body = await readJson(response);
      if (!response.ok) {
        setPlan(null);
        return;
      }
      setPlan(body.data.plan as ErasurePlan);
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleExecuteErasure() {
    if (confirmInput !== 'ERASE') return;
    setExecuting(true);
    try {
      const response = await fetch(
        `/api/compliance/privacy-requests/${requestId}/erasure/execute`,
        {
          method: 'POST',
        }
      );
      const body = await readJson(response);
      if (!response.ok) {
        notify.error(body?.error ?? 'Failed to execute erasure.');
        return;
      }
      setConfirmInput('');
      setConfirmOpen(false);
      if (body?.data?.manualReviewRequired) {
        notify.info('Erasure completed — manual review required before closing the request.');
      } else {
        notify.success('Erasure executed.');
      }
      await loadDetail();
    } finally {
      setExecuting(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}/export`, {
        method: 'POST',
      });
      const body = await readJson(response);
      if (!response.ok) {
        notify.error(body?.error ?? 'Failed to generate export.');
        return;
      }
      notify.success('Export generated.');
      await loadDetail();
    } finally {
      setGenerating(false);
    }
  }

  async function handleMoveToProcessing() {
    setTransitioning(true);
    try {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus: 'PROCESSING' }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        notify.error(body?.error ?? 'Failed to move request to Processing.');
        return;
      }
      notify.success('Request moved to Processing.');
      await loadDetail();
      router.refresh();
    } catch {
      notify.error('Failed to move request to Processing.');
    } finally {
      setTransitioning(false);
    }
  }

  async function handleVerifyIdentity() {
    setTransitioning(true);
    try {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toStatus: 'IN_REVIEW',
          verificationMethod: 'ADMIN_ATTESTATION',
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        notify.error(body?.error ?? 'Failed to verify identity.');
        return;
      }
      notify.success('Identity verified (moved to In Review).');
      await loadDetail();
      router.refresh();
    } catch {
      notify.error('Failed to verify identity.');
    } finally {
      setTransitioning(false);
    }
  }

  async function handleCompleteRequest() {
    setTransitioning(true);
    try {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatus: 'COMPLETED' }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        notify.error(body?.error ?? 'Failed to mark request as completed.');
        return;
      }
      notify.success('Privacy request marked as Completed.');
      await loadDetail();
      router.refresh();
    } catch {
      notify.error('Failed to mark request as completed.');
    } finally {
      setTransitioning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) {
          void loadDetail();
        } else {
          setPlan(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {detail?.requestType === 'ERASURE' ? 'Subject erasure' : 'Subject access export'}
          </DialogTitle>
          <DialogDescription>
            {detail?.requestType === 'ERASURE'
              ? 'Preview and execute verified erasure and anonymization for this subject. This cannot be undone.'
              : "Generate and download an encrypted, time-limited export of this subject's direct data relations. Security credentials are always excluded."}
          </DialogDescription>
        </DialogHeader>

        {loading && !detail ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : detail ? (
          <div className="space-y-4">
            {/* Visual Lifecycle Stepper */}
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                {lifecycleSteps.map((step, idx) => {
                  const isLast = idx === lifecycleSteps.length - 1;
                  return (
                    <div key={step.id} className="flex flex-1 items-center">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                            step.status === 'complete'
                              ? toneClasses('ok').soft
                              : step.status === 'current'
                                ? 'border-primary bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20'
                                : step.status === 'error'
                                  ? toneClasses('critical').soft
                                  : 'border-muted-foreground/30 bg-muted/80 text-muted-foreground'
                          }`}
                        >
                          {step.status === 'complete' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : step.status === 'error' ? (
                            <XCircle className="h-4 w-4" />
                          ) : (
                            <span>{idx + 1}</span>
                          )}
                        </div>
                        <div className="hidden sm:block">
                          <p className="text-xs font-medium leading-none">{step.label}</p>
                          {step.caption && (
                            <p className="mt-0.5 text-2xs text-muted-foreground">{step.caption}</p>
                          )}
                        </div>
                      </div>
                      {!isLast && (
                        <div
                          className={`mx-2 h-0.5 flex-1 transition-colors ${
                            step.status === 'complete'
                              ? 'bg-status-ok/60'
                              : 'bg-muted-foreground/20'
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Subject & Request Details Card */}
            <div className="space-y-3 rounded-lg border bg-card p-3.5 text-sm shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {subjectUser?.name ??
                          (detail.subjectType === 'USER' ? 'Registered User' : 'Status Subscriber')}
                      </span>
                      {subjectUser?.email && (
                        <span className="text-xs font-normal text-muted-foreground">
                          ({subjectUser.email})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                      <span className="font-sans text-2xs uppercase tracking-wider text-muted-foreground/70">
                        Subject:
                      </span>
                      <span>
                        {detail.subjectType}: {detail.subjectId}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={STATUS_BADGE_CLASS[detail.status]}>
                    {detail.status.replaceAll('_', ' ')}
                  </Badge>
                  <Badge variant="secondary" className="text-xs font-medium">
                    {detail.requestType.replaceAll('_', ' ')}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Requested:{' '}
                    <strong className="font-medium text-foreground">
                      {new Date(detail.requestedAt).toLocaleString()}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Assigned to:{' '}
                    <strong className="font-medium text-foreground">
                      {detail.assignedTo?.name ?? detail.assignedTo?.email ?? 'Unassigned'}
                    </strong>
                  </span>
                </div>
                <div className="col-span-full flex flex-wrap items-center gap-2 border-t pt-2">
                  <span className="text-muted-foreground">Identity verification:</span>
                  {detail.verifiedAt ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-status-ok-deep dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        Verified on {new Date(detail.verifiedAt).toLocaleDateString()}
                        {detail.verificationMethod &&
                          ` via ${detail.verificationMethod.replaceAll('_', ' ').toLowerCase()}`}
                        {detail.verifiedBy &&
                          ` by ${detail.verifiedBy.name ?? detail.verifiedBy.email}`}
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-medium text-status-elevated-deep dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Pending verification</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Transition Callout when in IDENTITY_VERIFICATION */}
            {detail.status === 'IDENTITY_VERIFICATION' && (
              <div
                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border p-3 text-xs ${
                  detail.verifiedAt
                    ? 'border-border bg-muted'
                    : 'border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15'
                }`}
              >
                <div className="space-y-0.5">
                  <p
                    className={`font-semibold ${
                      detail.verifiedAt
                        ? 'text-muted-foreground'
                        : 'text-status-elevated-deep dark:text-amber-300'
                    }`}
                  >
                    {detail.verifiedAt
                      ? 'Identity verified & ready for processing'
                      : 'Identity verification required'}
                  </p>
                  <p
                    className={
                      detail.verifiedAt
                        ? 'text-muted-foreground'
                        : 'text-status-elevated-deep dark:text-amber-300'
                    }
                  >
                    {detail.verifiedAt
                      ? `Advance this request to Processing to execute ${
                          detail.requestType === 'ERASURE' ? 'erasure' : 'export'
                        }.`
                      : "Verify the subject's identity before advancing this request to Processing."}
                  </p>
                </div>
                {canManage && (
                  <div className="shrink-0">
                    {detail.verifiedAt ? (
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => void handleMoveToProcessing()}
                        disabled={transitioning}
                      >
                        {transitioning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        Move to Processing
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => void handleVerifyIdentity()}
                        disabled={transitioning}
                      >
                        {transitioning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle className="h-3.5 w-3.5" />
                        )}
                        Verify identity
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Quick Transition Callout when erasure execution has succeeded in PROCESSING */}
            {detail.status === 'PROCESSING' && detail.erasureExecution?.status === 'COMPLETED' && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-status-ok-border/30 bg-status-ok-soft dark:border-status-ok/35 dark:bg-status-ok/15 p-3 text-xs">
                <div className="space-y-0.5">
                  <p className="font-semibold text-status-ok-deep dark:text-emerald-300">
                    Erasure execution completed
                  </p>
                  <p className="text-status-ok-deep dark:text-emerald-300">
                    Subject data has been permanently erased and anonymized. Mark this request as
                    Completed to close the ticket.
                  </p>
                </div>
                {canManage && (
                  <div className="shrink-0">
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => void handleCompleteRequest()}
                      disabled={transitioning}
                    >
                      {transitioning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Mark as Completed
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Blocked or Rejected Notifications */}
            {detail.status === 'BLOCKED' && (
              <div className="rounded-lg border border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15 text-status-elevated-deep dark:text-amber-300 p-3 text-xs">
                <p className="font-semibold">Request is currently blocked</p>
                <p className="mt-0.5">
                  {detail.notes ?? 'Resolve blocking conditions or legal holds before proceeding.'}
                </p>
              </div>
            )}
            {detail.status === 'REJECTED' && (
              <div className="rounded-lg border border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300 p-3 text-xs">
                <p className="font-semibold">Request was rejected</p>
                <p className="mt-0.5">
                  {detail.notes ? `Reason: ${detail.notes}` : 'No specific reason recorded.'}
                </p>
              </div>
            )}

            {canExport && detail.requestType !== 'ERASURE' && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="text-sm">
                  {automated ? (
                    exportEligible ? (
                      <span>Ready to generate a new export for this request.</span>
                    ) : !detail.verifiedAt ? (
                      <span className="text-status-elevated-deep dark:text-amber-300">
                        Complete identity verification and move this request to Processing before
                        generating an export.
                      </span>
                    ) : (
                      <span className="text-status-elevated-deep dark:text-amber-300">
                        Identity is verified. Move this request to Processing before generating an
                        export.
                      </span>
                    )
                  ) : (
                    <span className="text-status-elevated-deep dark:text-amber-300">
                      {detail.subjectType === 'STATUS_SUBSCRIBER'
                        ? 'Status-page subscriber export is not yet automated and requires manual fulfilment.'
                        : 'This request type is not yet automated and requires manual fulfilment.'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canManage && !detail.verifiedAt && detail.status === 'IDENTITY_VERIFICATION' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleVerifyIdentity()}
                      disabled={transitioning}
                    >
                      {transitioning ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Verify identity
                    </Button>
                  )}
                  {canManage && Boolean(detail.verifiedAt) && detail.status !== 'PROCESSING' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleMoveToProcessing()}
                      disabled={transitioning}
                    >
                      {transitioning ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Move to Processing
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleGenerate}
                    disabled={!automated || !exportEligible || generating}
                  >
                    {generating ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <FileArchive className="mr-1.5 h-4 w-4" />
                    )}
                    Generate export
                  </Button>
                </div>
              </div>
            )}

            {detail.requestType === 'ERASURE' && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldAlert className="h-4 w-4" />
                    Erasure plan
                  </div>
                  {detail.erasureExecution && (
                    <Badge
                      variant="outline"
                      className={EXECUTION_BADGE_CLASS[detail.erasureExecution.status]}
                      title={detail.erasureExecution.failureCode ?? undefined}
                    >
                      {detail.erasureExecution.status}
                    </Badge>
                  )}
                </div>

                {!canErase ? (
                  <p className="text-xs text-muted-foreground">
                    You do not have permission to preview or execute erasure.
                  </p>
                ) : planLoading && !plan ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building plan…
                  </div>
                ) : plan ? (
                  <>
                    {plan.blockingConditions.length > 0 && (
                      <ul className="list-inside list-disc space-y-1 text-xs text-status-elevated-deep dark:text-amber-300">
                        {plan.blockingConditions.map(condition => (
                          <li key={condition}>{condition}</li>
                        ))}
                      </ul>
                    )}
                    <div className="max-h-40 overflow-y-auto rounded border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Domain</TableHead>
                            <TableHead>Strategy</TableHead>
                            <TableHead className="text-right">Count</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plan.domains
                            .filter(domain => domain.count > 0)
                            .map(domain => (
                              <TableRow key={domain.id}>
                                <TableCell className="text-xs">{domain.label}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {domain.strategy}
                                </TableCell>
                                <TableCell className="text-right text-xs">{domain.count}</TableCell>
                              </TableRow>
                            ))}
                          {plan.domains.every(domain => domain.count === 0) && (
                            <TableRow>
                              <TableCell
                                colSpan={3}
                                className="py-4 text-center text-muted-foreground"
                              >
                                No data found for this subject.
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {!detail.verifiedAt
                          ? 'Complete identity verification and move this request to Processing before erasure can run.'
                          : detail.status !== 'PROCESSING'
                            ? 'Identity is verified. Move this request to Processing before erasure can run.'
                            : plan.canExecute
                              ? 'Ready to execute — this cannot be undone.'
                              : 'Blocking conditions must be resolved before erasure can run.'}
                      </p>
                      <div className="flex items-center gap-2">
                        {canManage &&
                          !detail.verifiedAt &&
                          detail.status === 'IDENTITY_VERIFICATION' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleVerifyIdentity()}
                              disabled={transitioning}
                            >
                              {transitioning ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Verify identity
                            </Button>
                          )}
                        {canManage &&
                          Boolean(detail.verifiedAt) &&
                          detail.status !== 'PROCESSING' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleMoveToProcessing()}
                              disabled={transitioning}
                            >
                              {transitioning ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Move to Processing
                            </Button>
                          )}
                        {canManage &&
                        detail.erasureExecution?.status === 'COMPLETED' &&
                        detail.status === 'PROCESSING' ? (
                          <Button
                            size="sm"
                            className="text-xs"
                            onClick={() => void handleCompleteRequest()}
                            disabled={transitioning}
                          >
                            {transitioning ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Mark as Completed
                          </Button>
                        ) : (
                          <AlertDialog
                            open={confirmOpen}
                            onOpenChange={next => {
                              setConfirmOpen(next);
                              if (!next) setConfirmInput('');
                            }}
                          >
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setConfirmOpen(true)}
                              disabled={
                                !exportEligible ||
                                !plan.canExecute ||
                                executing ||
                                detail.erasureExecution?.status === 'COMPLETED'
                              }
                            >
                              {executing ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="mr-1.5 h-4 w-4" />
                              )}
                              Execute erasure
                            </Button>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                                  <ShieldAlert className="h-4 w-4" />
                                  Permanently erase subject data?
                                </AlertDialogTitle>
                                <AlertDialogDescription asChild>
                                  <div className="space-y-2 text-left">
                                    <p>
                                      This will permanently remove and anonymize data for{' '}
                                      <span className="font-mono font-medium text-foreground">
                                        {detail.subjectType}: {detail.subjectId}
                                      </span>
                                      . This action cannot be undone.
                                    </p>
                                    <p className="text-xs">
                                      Type <span className="font-mono font-semibold">ERASE</span> to
                                      confirm.
                                    </p>
                                  </div>
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <Input
                                autoFocus
                                value={confirmInput}
                                onChange={event => setConfirmInput(event.target.value)}
                                placeholder="Type ERASE to confirm"
                                className="font-mono"
                                aria-label="Type ERASE to confirm erasure"
                              />
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={executing}>Cancel</AlertDialogCancel>
                                <Button
                                  variant="destructive"
                                  disabled={confirmInput !== 'ERASE' || executing}
                                  onClick={() => void handleExecuteErasure()}
                                >
                                  {executing ? (
                                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="mr-1.5 h-4 w-4" />
                                  )}
                                  Permanently erase
                                </Button>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <Button size="sm" variant="outline" onClick={() => void loadPlan()}>
                      Load erasure plan
                    </Button>
                    {canManage &&
                      detail.erasureExecution?.status === 'COMPLETED' &&
                      detail.status === 'PROCESSING' && (
                        <Button
                          size="sm"
                          className="text-xs"
                          onClick={() => void handleCompleteRequest()}
                          disabled={transitioning}
                        >
                          {transitioning ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Mark as Completed
                        </Button>
                      )}
                  </div>
                )}
              </div>
            )}

            {detail.requestType !== 'ERASURE' && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Downloads</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.exportArtifacts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          No exports generated yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {detail.exportArtifacts.map(artifact => {
                      const expired =
                        new Date(artifact.expiresAt).getTime() <= new Date().getTime();
                      const downloadable =
                        !expired &&
                        (artifact.status === 'READY' || artifact.status === 'DOWNLOADED');
                      return (
                        <TableRow key={artifact.id}>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                ARTIFACT_BADGE_CLASS[expired ? 'EXPIRED' : artifact.status]
                              }
                              title={artifact.failureReason ?? undefined}
                            >
                              {expired ? 'EXPIRED' : artifact.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(artifact.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(artifact.expiresAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatBytes(artifact.sizeBytes)}
                          </TableCell>
                          <TableCell className="text-xs">{artifact.downloadCount}</TableCell>
                          <TableCell className="text-right">
                            {downloadable ? (
                              <Button size="sm" variant="secondary" asChild>
                                <a
                                  href={`/api/compliance/privacy-requests/${requestId}/export/${artifact.id}/download`}
                                  onClick={() => window.setTimeout(() => void loadDetail(), 1000)}
                                >
                                  <Download className="mr-1.5 h-4 w-4" />
                                  Download
                                </a>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unavailable</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <Button size="sm" variant="ghost" onClick={() => void loadDetail()} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        ) : null}

        {!canManage && (
          <p className="text-xs text-muted-foreground">
            You have read-only access to privacy requests.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
import { Download, FileArchive, Loader2, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-product-notification';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';

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
  PENDING: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  RUNNING: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  PARTIAL: 'border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  COMPLETED: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  FAILED: 'border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

const ARTIFACT_BADGE_CLASS: Record<ExportArtifactStatus, string> = {
  PENDING: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  READY: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  DOWNLOADED: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  EXPIRED: 'border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  FAILED: 'border-rose-600/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
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
  exportEligible,
  trigger,
}: {
  requestId: string;
  canManage: boolean;
  canExport: boolean;
  canErase: boolean;
  automated: boolean;
  exportEligible: boolean;
  trigger: React.ReactNode;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [plan, setPlan] = useState<ErasurePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  async function loadDetail() {
    setLoading(true);
    try {
      const response = await fetch(`/api/compliance/privacy-requests/${requestId}`, {
        cache: 'no-store',
      });
      const body = await readJson(response);
      if (!response.ok) {
        showToast(body?.error ?? 'Failed to load request detail.', 'error');
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
        showToast(body?.error ?? 'Failed to execute erasure.', 'error');
        return;
      }
      showToast('Erasure executed.', 'success');
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
        showToast(body?.error ?? 'Failed to generate export.', 'error');
        return;
      }
      showToast('Export generated.', 'success');
      await loadDetail();
    } finally {
      setGenerating(false);
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
      <DialogContent className="max-w-2xl">
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
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Subject: </span>
                <span className="font-mono text-xs">
                  {detail.subjectType}: {detail.subjectId}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                {detail.status.replaceAll('_', ' ')}
              </div>
              <div>
                <span className="text-muted-foreground">Identity verified: </span>
                {detail.verifiedAt ? new Date(detail.verifiedAt).toLocaleString() : 'Not yet'}
              </div>
            </div>

            {canExport && detail.requestType !== 'ERASURE' && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="text-sm">
                  {automated ? (
                    exportEligible ? (
                      <span>Ready to generate a new export for this request.</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        Complete identity verification and move this request to Processing before
                        generating an export.
                      </span>
                    )
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      {detail.subjectType === 'STATUS_SUBSCRIBER'
                        ? 'Status-page subscriber export is not yet automated and requires manual fulfilment.'
                        : 'This request type is not yet automated and requires manual fulfilment.'}
                    </span>
                  )}
                </div>
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
                      <ul className="list-inside list-disc space-y-1 text-xs text-amber-600 dark:text-amber-400">
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
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {exportEligible
                          ? plan.canExecute
                            ? 'Ready to execute — this cannot be undone.'
                            : 'Blocking conditions must be resolved before erasure can run.'
                          : 'Complete identity verification and move this request to Processing before erasure can run.'}
                      </p>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleExecuteErasure}
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
                    </div>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void loadPlan()}>
                    Load erasure plan
                  </Button>
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
                      const expired = new Date(artifact.expiresAt).getTime() <= Date.now();
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

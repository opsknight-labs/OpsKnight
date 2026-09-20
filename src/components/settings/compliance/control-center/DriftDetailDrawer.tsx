'use client';

import React, { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/shadcn/sheet';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, Clock, FileCheck2, ArrowRight, Check, Copy } from 'lucide-react';
import { notify } from '@/lib/toast';
import { DriftStatusBadge } from './DriftStatusBadge';
import { DriftKindBadge } from './DriftKindBadge';
import type {
  ComplianceDriftKind,
  ComplianceDriftStatus,
  ComplianceDriftImpact,
} from '@/lib/compliance/drift/types';

export interface DriftDetailEventData {
  readonly id: string;
  readonly controlId: string | null;
  readonly kind: ComplianceDriftKind;
  readonly impact: ComplianceDriftImpact;
  readonly status: ComplianceDriftStatus;
  readonly summary: string;
  readonly details: Record<string, unknown>;
  readonly previousStatus: string | null;
  readonly currentStatus: string | null;
  readonly firstDetectedAt: string;
  readonly lastObservedAt: string;
  readonly occurrenceCount: number;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedByUserId: string | null;
  readonly resolvedAt: string | null;
  readonly baselineEvaluationId: string | null;
  readonly detectedEvaluationId: string | null;
  readonly baselineEvaluation?: {
    readonly id: string;
    readonly status: string;
    readonly evaluatedAt: string;
    readonly evaluatorVersion: string;
    readonly summary: string;
  } | null;
  readonly detectedEvaluation?: {
    readonly id: string;
    readonly status: string;
    readonly evaluatedAt: string;
    readonly evaluatorVersion: string;
    readonly summary: string;
  } | null;
  readonly evidence?: Array<{
    readonly id: string;
    readonly title: string;
    readonly type: string;
    readonly observedAt: string;
    readonly contentHash: string;
  }> | null;
  readonly frameworkMappings?: Array<{
    readonly framework: string;
    readonly requirementId: string;
  }>;
}

interface DriftDetailDrawerProps {
  readonly event: DriftDetailEventData | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly canManageDrift?: boolean;
  readonly onAcknowledged?: (eventId: string) => void;
  readonly onSelectControl?: (controlId: string) => void;
  readonly onNavigateToEvidence?: (controlId: string) => void;
}

export function DriftDetailDrawer({
  event,
  isOpen,
  onClose,
  canManageDrift = false,
  onAcknowledged,
  onSelectControl,
  onNavigateToEvidence,
}: DriftDetailDrawerProps) {
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  if (!event) return null;

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(event.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleAcknowledge = async () => {
    setIsAcknowledging(true);
    try {
      const res = await fetch(`/api/compliance/drift/${event.id}/acknowledge`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to acknowledge drift episode');
      }
      notify.success('Drift episode acknowledged');
      if (onAcknowledged) onAcknowledged(event.id);
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Acknowledgement failed');
    } finally {
      setIsAcknowledging(false);
    }
  };

  const isActionRequired = event.impact === 'ACTION_REQUIRED';
  const isVerificationGap = event.impact === 'VERIFICATION_GAP';

  return (
    <Sheet open={isOpen} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto p-6 space-y-6"
      >
        <SheetHeader className="space-y-2 text-left">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground border">
                {event.controlId ?? 'System Control'}
              </span>
              <DriftKindBadge kind={event.kind} />
              <DriftStatusBadge status={event.status} />
            </div>
            <button
              type="button"
              onClick={handleCopyId}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {copiedId ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copiedId ? 'Copied' : 'Copy ID'}
            </button>
          </div>
          <SheetTitle className="text-lg font-bold">
            {event.controlId ? `Drift Episode: ${event.controlId}` : 'Compliance Drift Episode'}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground leading-relaxed">
            {event.summary}
          </SheetDescription>
        </SheetHeader>

        {/* Transition Overview */}
        <div className="rounded-lg border border-border p-4 bg-muted/20 space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Observed Transition</div>
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Badge variant="outline" className="px-2.5 py-1">
              {event.previousStatus ?? 'UNKNOWN'}
            </Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge
              variant={
                isActionRequired ? 'destructive' : isVerificationGap ? 'secondary' : 'outline'
              }
              className="px-2.5 py-1"
            >
              {event.currentStatus ?? 'UNKNOWN'}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            This drift episode represents an observed technical state change. It does not certify
            compliance or non-compliance.
          </div>
        </div>

        {/* Timestamps & Occurrence */}
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="rounded-md border border-border p-3 space-y-1">
            <div className="text-muted-foreground text-[11px]">First Detected</div>
            <div className="font-medium">
              {new Date(event.firstDetectedAt).toLocaleDateString()}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(event.firstDetectedAt).toLocaleTimeString()}
            </div>
          </div>
          <div className="rounded-md border border-border p-3 space-y-1">
            <div className="text-muted-foreground text-[11px]">Last Observed</div>
            <div className="font-medium">{new Date(event.lastObservedAt).toLocaleDateString()}</div>
            <div className="text-[10px] text-muted-foreground">
              {new Date(event.lastObservedAt).toLocaleTimeString()}
            </div>
          </div>
          <div className="rounded-md border border-border p-3 space-y-1">
            <div className="text-muted-foreground text-[11px]">Occurrence Count</div>
            <div className="font-semibold text-sm">{event.occurrenceCount}x</div>
            <div className="text-[10px] text-muted-foreground">Deduplicated episode</div>
          </div>
        </div>

        {/* Acknowledgment & Resolution Metadata */}
        <div className="rounded-lg border border-border p-4 space-y-2 text-xs">
          <div className="font-semibold text-foreground">Operator & Technical Lifecycle</div>
          {event.acknowledgedAt ? (
            <div className="flex items-center gap-2 text-amber-500">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                Acknowledged on {new Date(event.acknowledgedAt).toLocaleString()}
                {event.acknowledgedByUserId ? ` by operator (${event.acknowledgedByUserId})` : ''}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Awaiting operator review and acknowledgment</span>
            </div>
          )}

          {event.status === 'RESOLVED' && event.resolvedAt && (
            <div className="flex items-center gap-2 text-emerald-500 pt-1 border-t border-border">
              <CheckCircle2 className="h-4 w-4" />
              <span>
                Factual technical recovery confirmed on{' '}
                {new Date(event.resolvedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Evaluation Comparison */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">
            Authoritative Evaluation References
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-md border border-border bg-muted/10 space-y-1">
              <div className="text-[11px] text-muted-foreground">Baseline Evaluation</div>
              <div className="font-mono text-[11px] truncate">
                {event.baselineEvaluationId ?? 'Established baseline'}
              </div>
              {event.baselineEvaluation && (
                <div className="text-[11px] text-muted-foreground">
                  Status:{' '}
                  <span className="font-medium text-foreground">
                    {event.baselineEvaluation.status}
                  </span>
                </div>
              )}
            </div>

            <div className="p-3 rounded-md border border-border bg-muted/10 space-y-1">
              <div className="text-[11px] text-muted-foreground">Detected Evaluation</div>
              <div className="font-mono text-[11px] truncate">
                {event.detectedEvaluationId ?? 'N/A'}
              </div>
              {event.detectedEvaluation && (
                <div className="text-[11px] text-muted-foreground">
                  Status:{' '}
                  <span className="font-medium text-foreground">
                    {event.detectedEvaluation.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-border">
          {event.status === 'OPEN' && canManageDrift && (
            <Button
              size="sm"
              onClick={handleAcknowledge}
              disabled={isAcknowledging}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8"
            >
              {isAcknowledging ? 'Acknowledging...' : 'Acknowledge Drift'}
            </Button>
          )}

          {event.controlId && onSelectControl && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onSelectControl(event.controlId!);
              }}
              className="text-xs h-8"
            >
              View Control
            </Button>
          )}

          {event.controlId && onNavigateToEvidence && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onNavigateToEvidence(event.controlId!);
              }}
              className="text-xs h-8"
            >
              <FileCheck2 className="h-3.5 w-3.5 mr-1.5" />
              View Evidence
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

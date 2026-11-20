'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Shield,
  ExternalLink,
  AlertCircle,
  FileCheck2,
  Clock,
  UserCheck,
  Building2,
  Loader2,
  CheckCircle2,
  CircleDashed,
} from 'lucide-react';
import type { ComplianceEvaluationStatus, ComplianceFramework } from '@/lib/compliance/types';
import type {
  FrameworkRequirementView,
  ComplianceFrameworkDefinition,
  RequirementLifecycle,
} from '@/lib/compliance/framework-mappings/types';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns';

interface FrameworkRequirementsModalProps {
  readonly frameworkId: ComplianceFramework | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

interface ApiResponse {
  readonly framework: ComplianceFrameworkDefinition;
  readonly requirements: readonly FrameworkRequirementView[];
}

const lifecyclePresentation: Record<
  RequirementLifecycle,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  ACTIVE: {
    label: 'Active Requirement',
    className: toneClasses('ok').soft,
    icon: CheckCircle2,
  },
  FUTURE: {
    label: 'Future Staged',
    className: toneClasses(null).soft,
    icon: Clock,
  },
  SUPERSEDED: {
    label: 'Superseded',
    className: toneClasses(null).soft,
    icon: CircleDashed,
  },
  REFERENCE_ONLY: {
    label: 'Reference Only',
    className: toneClasses(null).soft,
    icon: CircleDashed,
  },
};

const runtimeStatusPresentation: Record<
  ComplianceEvaluationStatus,
  { label: string; className: string }
> = {
  IMPLEMENTED: {
    label: 'Implemented',
    className: toneClasses('ok').soft,
  },
  PARTIAL: {
    label: 'Partial',
    className: toneClasses('elevated').soft,
  },
  ACTION_REQUIRED: {
    label: 'Action Required',
    className: toneClasses('critical').soft,
  },
  UNVERIFIED: {
    label: 'Unverified',
    className: toneClasses(null).soft,
  },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    className: toneClasses(null).soft,
  },
};

export function FrameworkRequirementsModal({
  frameworkId,
  isOpen,
  onClose,
}: FrameworkRequirementsModalProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setData(null);
      setError(null);
      setIsLoading(false);
      onClose();
    }
  };

  useEffect(() => {
    if (!isOpen || !frameworkId) {
      return;
    }

    const abortController = new AbortController();
    let isMounted = true;

    const timer = setTimeout(() => {
      if (!isMounted) return;
      setIsLoading(true);
      setError(null);

      fetch(`/api/compliance/frameworks/${frameworkId}/requirements`, {
        signal: abortController.signal,
      })
        .then(async res => {
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `Failed to fetch requirements (${res.status})`);
          }
          return res.json();
        })
        .then(resData => {
          if (isMounted) {
            setData(resData);
            setIsLoading(false);
          }
        })
        .catch(err => {
          if (isMounted && !abortController.signal.aborted) {
            setError(err.message || 'Failed to load framework requirements');
            setIsLoading(false);
          }
        });
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      abortController.abort();
    };
  }, [isOpen, frameworkId]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          {data?.framework ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg font-bold text-foreground">
                    {data.framework.title}
                  </DialogTitle>
                  <Badge variant="outline" className="font-mono text-xs font-semibold">
                    {data.framework.version}
                  </Badge>
                  <Badge variant="secondary" className="text-2xs font-mono">
                    {data.framework.frameworkType}
                  </Badge>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Authoritative Source: {data.framework.authoritativeSource}
                </DialogDescription>
              </div>
              <a
                href={data.framework.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-semibold shrink-0"
              >
                <span>Official Specification</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <DialogTitle className="text-lg font-bold text-foreground">
              Framework Requirements
            </DialogTitle>
          )}
        </DialogHeader>

        {/* Non-certification disclaimer banner */}
        <div className="rounded-lg border border-border/80 bg-muted/40 p-3.5 text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <span>Shared Responsibility &amp; Evidence Collection Boundary</span>
          </div>
          <p>
            Mapping an OpsKnight control to a framework requirement indicates technical evidence
            collection only. It does not certify compliance or satisfy organizational obligations.
          </p>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-xs">Loading mapped framework requirements...</p>
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => onClose()}>
              Close
            </Button>
          </div>
        )}

        {/* Requirements list */}
        {data && !isLoading && !error && (
          <div className="space-y-4 mt-2">
            <div className="text-xs text-muted-foreground font-mono">
              Showing {data.requirements.length} catalog requirements; requirements without control
              mappings are identified in their detail.
            </div>

            <div className="space-y-3">
              {data.requirements.map(reqView => {
                const req = reqView.requirement;
                const lifecycleConfig =
                  lifecyclePresentation[reqView.resolvedLifecycle] ?? lifecyclePresentation.ACTIVE;
                const LifecycleIcon = lifecycleConfig.icon;

                const operatorMappings = reqView.mappings.filter(
                  m =>
                    m.relationship === 'OPERATOR_DEPENDENCY' || m.evidenceExpectation === 'OPERATOR'
                );
                const orgMappings = reqView.mappings.filter(
                  m =>
                    m.relationship === 'ORGANIZATIONAL_DEPENDENCY' ||
                    m.evidenceExpectation === 'ORGANIZATIONAL'
                );

                return (
                  <div
                    key={req.id}
                    className="rounded-lg border border-border/80 bg-card p-4 space-y-3 shadow-2xs"
                  >
                    {/* Header */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-foreground">
                            {req.reference}
                          </span>
                          <span className="text-sm font-semibold text-foreground">{req.title}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-2xs font-semibold flex items-center gap-1',
                              lifecycleConfig.className
                            )}
                          >
                            <LifecycleIcon className="h-2.5 w-2.5" />
                            <span>{lifecycleConfig.label}</span>
                            {req.effectiveFrom && reqView.resolvedLifecycle === 'FUTURE' && (
                              <span className="font-mono">({req.effectiveFrom})</span>
                            )}
                          </Badge>
                          <Badge variant="secondary" className="text-2xs font-mono">
                            {req.applicability}
                          </Badge>
                        </div>
                        <span className="text-2xs font-mono text-muted-foreground block">
                          ID: {req.id}
                        </span>
                      </div>

                      <a
                        href={req.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-2xs text-primary hover:underline shrink-0"
                      >
                        <span>Source</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>

                    {/* Summary */}
                    <p className="text-xs text-muted-foreground leading-relaxed">{req.summary}</p>

                    {/* Mapped Controls */}
                    {reqView.mappings.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <span className="text-2xs font-semibold text-foreground block">
                          Supporting Technical Controls ({reqView.mappings.length})
                        </span>
                        <div className="grid gap-2">
                          {reqView.mappings.map(mapped => {
                            const runtimeStatus = mapped.runtimeState?.status
                              ? runtimeStatusPresentation[
                                  mapped.runtimeState.status as ComplianceEvaluationStatus
                                ]
                              : null;

                            return (
                              <div
                                key={mapped.mappingId}
                                className="rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono font-bold text-primary">
                                      {mapped.controlId}
                                    </span>
                                    <span className="font-medium text-foreground">
                                      {mapped.controlTitle}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <Badge
                                      variant="secondary"
                                      className="text-2xs py-0 px-1.5 font-normal"
                                    >
                                      {mapped.relationship.replace(/_/g, ' ')}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="text-2xs py-0 px-1.5 font-normal font-mono"
                                    >
                                      {mapped.evidenceExpectation}
                                    </Badge>
                                    {mapped.evidenceSummary && (
                                      <span
                                        className={cn(
                                          'inline-flex items-center gap-1 text-2xs font-medium',
                                          mapped.evidenceSummary.integrityValid
                                            ? 'text-status-ok-deep dark:text-emerald-300'
                                            : 'text-status-critical-deep dark:text-rose-300'
                                        )}
                                      >
                                        <FileCheck2 className="h-3 w-3" />
                                        {mapped.evidenceSummary.recordCount} evidence{' '}
                                        {mapped.evidenceSummary.integrityValid
                                          ? '(Verified)'
                                          : '(Integrity Mismatch)'}
                                      </span>
                                    )}
                                  </div>
                                  {mapped.rationale && (
                                    <p className="text-2xs text-muted-foreground italic">
                                      {mapped.rationale}
                                    </p>
                                  )}
                                </div>

                                {runtimeStatus ? (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-2xs font-semibold shrink-0 self-start sm:self-center',
                                      runtimeStatus.className
                                    )}
                                  >
                                    {runtimeStatus.label}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-2xs font-semibold text-ink-500 shrink-0 self-start sm:self-center"
                                  >
                                    Static Only
                                  </Badge>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Shared Responsibility Callouts */}
                    {(operatorMappings.length > 0 || orgMappings.length > 0) && (
                      <div className="pt-2 border-t border-border/40 grid sm:grid-cols-2 gap-2 text-xs">
                        {operatorMappings.length > 0 && (
                          <div className="rounded-lg border border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15 p-2.5 space-y-1">
                            <div className="flex items-center gap-1.5 font-semibold text-status-elevated-deep dark:text-amber-300 text-2xs">
                              <UserCheck className="h-3.5 w-3.5 shrink-0" />
                              <span>Operator Responsibility</span>
                            </div>
                            <ul className="list-disc list-inside text-2xs text-muted-foreground space-y-0.5">
                              {operatorMappings.map(m => (
                                <li key={m.mappingId}>
                                  <strong className="text-foreground">{m.controlId}:</strong>{' '}
                                  {m.rationale}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {orgMappings.length > 0 && (
                          <div className="rounded-lg border border-status-info-border/25 bg-status-info-soft dark:border-status-info/35 dark:bg-status-info/15 p-2.5 space-y-1">
                            <div className="flex items-center gap-1.5 font-semibold text-status-info-deep dark:text-blue-300 text-2xs">
                              <Building2 className="h-3.5 w-3.5 shrink-0" />
                              <span>Organizational Responsibility</span>
                            </div>
                            <ul className="list-disc list-inside text-2xs text-muted-foreground space-y-0.5">
                              {orgMappings.map(m => (
                                <li key={m.mappingId}>
                                  <strong className="text-foreground">{m.controlId}:</strong>{' '}
                                  {m.rationale}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

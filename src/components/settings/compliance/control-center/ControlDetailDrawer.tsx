'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/shadcn/sheet';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { AlertTriangle, FileCheck2, Copy, Check } from 'lucide-react';
import type { ComplianceControlCenterControl } from '@/lib/compliance/control-center/types';
import type { ComplianceFramework } from '@/lib/compliance/types';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { EvidenceIntegrityBadge } from './EvidenceIntegrityBadge';
import { RequirementLifecycleBadge } from './RequirementLifecycleBadge';
import { SharedResponsibilityCard } from './SharedResponsibilityCard';

interface ControlDetailDrawerProps {
  readonly control: ComplianceControlCenterControl | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onNavigateToEvidence?: (controlId: string) => void;
  readonly onNavigateToFramework?: (frameworkId: ComplianceFramework) => void;
}

export function ControlDetailDrawer({
  control,
  isOpen,
  onClose,
  onNavigateToEvidence,
  onNavigateToFramework,
}: ControlDetailDrawerProps) {
  const [copied, setCopied] = React.useState(false);

  if (!control) return null;

  const isRuntime = control.assessmentMode === 'RUNTIME';
  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(control.controlId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

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
                {control.controlId}
              </span>
              <button
                type="button"
                onClick={handleCopyId}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Copy Control ID"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {control.category}
              </Badge>
              <Badge
                variant="secondary"
                className={
                  isRuntime
                    ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20'
                    : 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-400'
                }
              >
                {isRuntime ? 'Runtime Control' : 'Repository Control'}
              </Badge>
            </div>
          </div>

          <SheetTitle className="text-xl font-bold">{control.title}</SheetTitle>
          <SheetDescription className="text-sm leading-relaxed text-muted-foreground">
            {control.description}
          </SheetDescription>
        </SheetHeader>

        {/* Runtime Assessment Section */}
        {isRuntime && control.runtime ? (
          <div className="space-y-3 p-4 rounded-lg border bg-card/60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Authoritative Runtime Assessment
              </span>
              <RuntimeStatusBadge status={control.runtime.status} />
            </div>

            <div className="text-sm p-2.5 rounded bg-muted/30 border border-border/50 text-foreground font-mono text-xs leading-relaxed">
              {control.runtime.summary}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div>
                <span className="text-muted-foreground">Evaluator: </span>
                <span className="font-mono font-medium">
                  {control.runtime.evaluatorId ?? 'unknown'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Version: </span>
                <span className="font-mono font-medium">
                  {control.runtime.evaluatorVersion ?? 'unknown'}{' '}
                  {control.runtime.isVersionCurrent ? (
                    <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                      (Current)
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 text-[11px]">(Stale)</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Last Evaluated: </span>
                <span className="font-medium">
                  {new Date(control.runtime.evaluatedAt).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Valid Until: </span>
                <span className="font-medium">
                  {control.runtime.validUntil
                    ? new Date(control.runtime.validUntil).toLocaleString()
                    : 'Indefinite'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4 rounded-lg border bg-card/60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Repository Assessment
              </span>
              <Badge variant="outline" className="text-xs">
                Code Baseline
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This control is assessed via static architectural review and codebase implementation
              baseline.
            </p>
          </div>
        )}

        {/* Supporting Evidence Section */}
        <div className="space-y-3 p-4 rounded-lg border bg-card/60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Durable Supporting Evidence
            </span>
            <EvidenceIntegrityBadge
              integrity={control.evidence.latestIntegrity ?? control.evidence.integrity}
              count={control.evidence.count}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>
              {control.evidence.count === 0
                ? 'No durable evidence records stored yet.'
                : `${control.evidence.count} durable evidence record(s) collected.`}
            </span>
            {control.evidence.latestObservedAt && (
              <span>
                Latest: {new Date(control.evidence.latestObservedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {control.evidence.latestDigest && (
            <div className="text-[11px] font-mono text-muted-foreground bg-muted/40 p-2 rounded border border-border/50 truncate">
              Latest SHA-256: {control.evidence.latestDigest}
            </div>
          )}

          {control.evidence.count > 0 && onNavigateToEvidence && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5 mt-2"
              onClick={() => {
                onClose();
                onNavigateToEvidence(control.controlId);
              }}
            >
              <FileCheck2 className="h-3.5 w-3.5 text-sky-500" />
              <span>Inspect {control.evidence.count} Evidence Record(s)</span>
            </Button>
          )}
        </div>

        {/* Mapped Framework Requirements */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mapped Framework Requirements ({control.frameworkMappings.length})
            </h4>
          </div>

          {control.frameworkMappings.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No framework requirements explicitly mapped.
            </p>
          ) : (
            <div className="space-y-2">
              {control.frameworkMappings.map(m => (
                <div
                  key={`${m.framework}-${m.requirementId}`}
                  className="p-3 rounded-lg border border-border/60 bg-muted/10 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (onNavigateToFramework) {
                            onClose();
                            onNavigateToFramework(m.framework);
                          }
                        }}
                        disabled={!onNavigateToFramework}
                        className={onNavigateToFramework ? 'cursor-pointer' : 'cursor-default'}
                      >
                        <Badge
                          variant="secondary"
                          className="text-[11px] font-mono hover:bg-muted transition-colors"
                        >
                          {m.framework}
                        </Badge>
                      </button>
                      <span className="font-semibold text-xs text-foreground">{m.reference}</span>
                    </div>
                    <RequirementLifecycleBadge lifecycle={m.lifecycle} />
                  </div>

                  <p className="text-xs text-foreground font-medium">{m.title}</p>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
                    <span>
                      Relation: <strong className="text-foreground">{m.relationship}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Expectation:{' '}
                      <strong className="text-foreground">{m.evidenceExpectation}</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Shared Responsibility */}
        <SharedResponsibilityCard
          operatorResponsibility={control.gaps.length > 0 ? control.gaps.join(' ') : undefined}
          compact
        />

        {/* Gaps / Operator Reminders */}
        {control.gaps.length > 0 && (
          <div className="space-y-2 p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Operator & Organizational Gaps</span>
            </div>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
              {control.gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

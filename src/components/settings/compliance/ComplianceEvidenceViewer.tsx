'use client';

import React, { useState } from 'react';
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
  Check,
  Copy,
  ShieldCheck,
  AlertTriangle,
  Database,
  Calendar,
  Tag,
  Layers,
} from 'lucide-react';
import type {
  ComplianceEvidenceRecord,
  ComplianceEvidenceType,
} from '@/lib/compliance/evidence/types';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns';

export interface ComplianceEvidenceViewerProps {
  readonly evidence: ComplianceEvidenceRecord | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const typePresentation: Record<ComplianceEvidenceType, { label: string; className: string }> = {
  VERIFICATION_RESULT: {
    label: 'Verification Result',
    className: toneClasses('ok').soft,
  },
  CONFIGURATION_SNAPSHOT: {
    label: 'Configuration Snapshot',
    className: toneClasses('info').soft,
  },
  SYSTEM_STATE: {
    label: 'System State',
    className: toneClasses(null).soft,
  },
  CAPABILITY_CHECK: {
    label: 'Capability Check',
    className: toneClasses(null).soft,
  },
  EXECUTION_SUMMARY: {
    label: 'Execution Summary',
    className: toneClasses(null).soft,
  },
  EVALUATION_FAILURE: {
    label: 'Evaluation Failure',
    className: toneClasses('critical').soft,
  },
};

export function ComplianceEvidenceViewer({
  evidence,
  isOpen,
  onClose,
}: ComplianceEvidenceViewerProps) {
  const [copiedHash, setCopiedHash] = useState(false);

  if (!evidence) {
    return null;
  }

  const typeConfig = typePresentation[evidence.type] ?? {
    label: evidence.type,
    className: toneClasses(null).soft,
  };

  const handleCopyHash = async () => {
    try {
      await navigator.clipboard.writeText(evidence.contentHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={cn('text-xs font-semibold px-2.5 py-0.5', typeConfig.className)}
            >
              {typeConfig.label}
            </Badge>
            <span className="font-mono text-2xs text-muted-foreground">ID: {evidence.id}</span>
          </div>
          <DialogTitle className="text-base font-bold text-foreground">
            {evidence.title}
          </DialogTitle>
          {evidence.description && (
            <DialogDescription className="text-xs text-muted-foreground">
              {evidence.description}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Cryptographic Integrity Card */}
        {evidence.integrityValid === false ? (
          <div className="rounded-lg border border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-status-critical-deep dark:text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-status-critical-deep dark:text-rose-300" />
                Cryptographic Integrity Mismatch (Tampered Record)
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyHash}
                className="h-7 text-2xs text-status-critical-deep dark:text-rose-300 hover:bg-status-critical/10 px-2"
              >
                {copiedHash ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy Hash
                  </>
                )}
              </Button>
            </div>
            <p className="text-2xs text-status-critical-deep dark:text-rose-300">
              Warning: Recomputed canonical SHA-256 digest does not match stored content hash.
            </p>
            <div className="font-mono text-2xs bg-background/80 dark:bg-background/40 border text-status-critical-deep dark:text-rose-300 border-status-critical-border/30 rounded-lg p-2 break-all select-all">
              {evidence.contentHash}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-status-ok-border/30 bg-status-ok-soft dark:border-status-ok/35 dark:bg-status-ok/15 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-status-ok-deep dark:text-emerald-300 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                Integrity Verified (SHA-256 matches canonical payload)
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyHash}
                className="h-7 text-2xs text-status-ok-deep dark:text-emerald-300 hover:bg-status-ok/10 px-2"
              >
                {copiedHash ? (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy Hash
                  </>
                )}
              </Button>
            </div>
            <div className="font-mono text-2xs bg-background/80 dark:bg-background/40 border border-border/60 rounded-lg p-2 break-all text-foreground select-all">
              {evidence.contentHash}
            </div>
          </div>
        )}

        {/* Fact Grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-2xs">
              <Tag className="h-3 w-3" /> Control Reference
            </span>
            <div className="font-mono font-bold text-primary">{evidence.controlId}</div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-2xs">
              <Layers className="h-3 w-3" /> Collector
            </span>
            <div className="font-medium text-foreground">
              {evidence.collectorId}{' '}
              <span className="text-muted-foreground font-mono text-2xs">
                (v{evidence.collectorVersion})
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-2xs">
              <Calendar className="h-3 w-3" /> Observed Timestamp
            </span>
            <div className="font-mono text-2xs text-foreground">
              {new Date(evidence.observedAt).toLocaleString()}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-2xs">
              <Database className="h-3 w-3" /> Resource Scope
            </span>
            <div className="font-mono text-2xs text-foreground truncate">
              {evidence.resourceType ?? 'N/A'}
              {evidence.resourceId ? ` (${evidence.resourceId})` : ''}
            </div>
          </div>
        </div>

        {/* Metadata Details */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-foreground">Observed Evidence Metadata</span>
            <span className="text-2xs text-muted-foreground font-mono">
              {Object.keys(evidence.metadata).length} fact keys
            </span>
          </div>
          <div className="rounded-lg border border-border/80 bg-muted/30 dark:bg-muted/10 p-3 overflow-x-auto max-h-60">
            <pre className="font-mono text-2xs text-foreground whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(evidence.metadata, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

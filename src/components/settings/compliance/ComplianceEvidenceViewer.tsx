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

export interface ComplianceEvidenceViewerProps {
  readonly evidence: ComplianceEvidenceRecord | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

const typePresentation: Record<ComplianceEvidenceType, { label: string; className: string }> = {
  VERIFICATION_RESULT: {
    label: 'Verification Result',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  CONFIGURATION_SNAPSHOT: {
    label: 'Configuration Snapshot',
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  SYSTEM_STATE: {
    label: 'System State',
    className: 'border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400',
  },
  CAPABILITY_CHECK: {
    label: 'Capability Check',
    className: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  },
  EXECUTION_SUMMARY: {
    label: 'Execution Summary',
    className: 'border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  EVALUATION_FAILURE: {
    label: 'Evaluation Failure',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
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
    className: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
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
            <span className="font-mono text-[11px] text-muted-foreground">ID: {evidence.id}</span>
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
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                Cryptographic Integrity Mismatch (Tampered Record)
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyHash}
                className="h-7 text-[11px] text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 px-2"
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
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              Warning: Recomputed canonical SHA-256 digest does not match stored content hash.
            </p>
            <div className="font-mono text-[11px] bg-background/80 dark:bg-background/40 border border-rose-500/30 rounded-lg p-2 break-all text-rose-700 dark:text-rose-300 select-all">
              {evidence.contentHash}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                Integrity Verified (SHA-256 matches canonical payload)
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyHash}
                className="h-7 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 px-2"
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
            <div className="font-mono text-[11px] bg-background/80 dark:bg-background/40 border border-border/60 rounded-lg p-2 break-all text-foreground select-all">
              {evidence.contentHash}
            </div>
          </div>
        )}

        {/* Fact Grid */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Tag className="h-3 w-3" /> Control Reference
            </span>
            <div className="font-mono font-bold text-primary">{evidence.controlId}</div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Layers className="h-3 w-3" /> Collector
            </span>
            <div className="font-medium text-foreground">
              {evidence.collectorId}{' '}
              <span className="text-muted-foreground font-mono text-[10px]">
                (v{evidence.collectorVersion})
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Calendar className="h-3 w-3" /> Observed Timestamp
            </span>
            <div className="font-mono text-[11px] text-foreground">
              {new Date(evidence.observedAt).toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Database className="h-3 w-3" /> Resource Scope
            </span>
            <div className="font-mono text-[11px] text-foreground truncate">
              {evidence.resourceType ?? 'N/A'}
              {evidence.resourceId ? ` (${evidence.resourceId})` : ''}
            </div>
          </div>
        </div>

        {/* Metadata Details */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-foreground">Observed Evidence Metadata</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {Object.keys(evidence.metadata).length} fact keys
            </span>
          </div>
          <div className="rounded-xl border border-border/80 bg-muted/30 dark:bg-muted/10 p-3 overflow-x-auto max-h-60">
            <pre className="font-mono text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(evidence.metadata, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

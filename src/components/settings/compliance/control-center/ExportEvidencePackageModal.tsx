'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Download, FileArchive, AlertTriangle, Loader2, Layers, CheckCircle2 } from 'lucide-react';
import { notify } from '@/lib/toast';
import type { ComplianceFramework } from '@/lib/compliance/types';
import type {
  EvidencePackageScope,
  EvidenceSelection,
  ExportPackagePreview,
} from '@/lib/compliance/export/types';
import { COMPLIANCE_FRAMEWORK_ENUM } from '@/lib/compliance/export/validation';

interface ExportEvidencePackageModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly availableControls: readonly { readonly id: string; readonly title: string }[];
}

export function ExportEvidencePackageModal({
  isOpen,
  onClose,
  availableControls,
}: ExportEvidencePackageModalProps) {
  const [scopeType, setScopeType] = useState<'DEPLOYMENT' | 'FRAMEWORK' | 'CONTROLS'>('DEPLOYMENT');
  const [selectedFramework, setSelectedFramework] = useState<ComplianceFramework>('GDPR');
  const [selectedControlIds, setSelectedControlIds] = useState<string[]>([]);
  const [evidenceMode, setEvidenceMode] = useState<'SNAPSHOT' | 'HISTORICAL'>('SNAPSHOT');

  // Historical dates (default to last 30 days)
  const defaultTo = new Date().toISOString().slice(0, 16);
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const [preview, setPreview] = useState<ExportPackagePreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Initialize selected controls if empty
  useEffect(() => {
    if (availableControls.length > 0 && selectedControlIds.length === 0) {
      setSelectedControlIds([availableControls[0].id]);
    }
  }, [availableControls, selectedControlIds.length]);

  const getScopePayload = useCallback((): EvidencePackageScope => {
    if (scopeType === 'DEPLOYMENT') return { type: 'DEPLOYMENT' };
    if (scopeType === 'FRAMEWORK') return { type: 'FRAMEWORK', framework: selectedFramework };
    return { type: 'CONTROLS', controlIds: selectedControlIds };
  }, [scopeType, selectedFramework, selectedControlIds]);

  const getEvidencePayload = useCallback((): EvidenceSelection => {
    if (evidenceMode === 'SNAPSHOT') return { mode: 'SNAPSHOT' };
    return {
      mode: 'HISTORICAL',
      from: new Date(fromDate).toISOString(),
      to: new Date(toDate).toISOString(),
    };
  }, [evidenceMode, fromDate, toDate]);

  // Fetch count preview when parameters change
  useEffect(() => {
    if (!isOpen) return;
    if (scopeType === 'CONTROLS' && selectedControlIds.length === 0) return;

    const scopePayload = getScopePayload();
    const evidencePayload = getEvidencePayload();

    let cancelled = false;
    setIsLoadingPreview(true);

    fetch('/api/compliance/exports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: scopePayload,
        evidence: evidencePayload,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.data) {
          setPreview(data.data);
        }
      })
      .catch(() => {
        // Silently ignore preview network errors
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, scopeType, selectedControlIds.length, getScopePayload, getEvidencePayload]);

  const handleToggleControl = (controlId: string) => {
    setSelectedControlIds(prev =>
      prev.includes(controlId) ? prev.filter(id => id !== controlId) : [...prev, controlId]
    );
  };

  const handleExport = async () => {
    if (scopeType === 'CONTROLS' && selectedControlIds.length === 0) {
      notify.error('Please select at least one control to export.');
      return;
    }

    setIsExporting(true);
    notify.info('Generating verifiable evidence package archive...');

    try {
      const res = await fetch('/api/compliance/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: getScopePayload(),
          evidence: getEvidencePayload(),
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(
          errorJson.error?.message || errorJson.message || 'Failed to generate export package'
        );
      }

      // Download the streamed ZIP file
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition');
      let filename = 'opsknight-evidence-package.zip';
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      notify.success('Audit evidence package downloaded successfully');
      onClose();
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && !isExporting && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileArchive className="h-5 w-5 text-primary" />
            <DialogTitle>Export Evidence Package</DialogTitle>
          </div>
          <DialogDescription>
            Generate a verifiable audit archive containing canonical control observations, runtime
            states, supporting evidence, framework mappings, and SHA-256 integrity manifests.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2 text-sm">
          {/* Non-Certification Notice */}
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Factual Technical Telemetry Only</span>
              This package exports observed technical state and supporting evidence. It does not
              constitute legal advice, an audit opinion, or a certification of compliance.
            </div>
          </div>

          {/* Scope Selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Export Scope
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setScopeType('DEPLOYMENT')}
                className={`p-2.5 rounded-lg border text-left transition-all text-xs font-medium ${
                  scopeType === 'DEPLOYMENT'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                    : 'border-border/70 hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="block font-semibold text-foreground">Deployment</span>
                <span>All controls & mappings</span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType('FRAMEWORK')}
                className={`p-2.5 rounded-lg border text-left transition-all text-xs font-medium ${
                  scopeType === 'FRAMEWORK'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                    : 'border-border/70 hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="block font-semibold text-foreground">Framework</span>
                <span>Single standard or law</span>
              </button>

              <button
                type="button"
                onClick={() => setScopeType('CONTROLS')}
                className={`p-2.5 rounded-lg border text-left transition-all text-xs font-medium ${
                  scopeType === 'CONTROLS'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                    : 'border-border/70 hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="block font-semibold text-foreground">Selected Controls</span>
                <span>Explicit subset</span>
              </button>
            </div>
          </div>

          {/* Framework Selection */}
          {scopeType === 'FRAMEWORK' && (
            <div className="space-y-2 p-3 rounded-lg border bg-card/50">
              <Label className="text-xs font-semibold">Select Compliance Framework</Label>
              <select
                value={selectedFramework}
                onChange={e => setSelectedFramework(e.target.value as ComplianceFramework)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              >
                {COMPLIANCE_FRAMEWORK_ENUM.map(fw => (
                  <option key={fw} value={fw}>
                    {fw} —{' '}
                    {fw === 'GDPR'
                      ? 'General Data Protection Regulation'
                      : fw === 'CRA'
                        ? 'Cyber Resilience Act'
                        : fw === 'SOC2'
                          ? 'SOC 2 Trust Services Criteria'
                          : fw === 'ISO27001'
                            ? 'ISO/IEC 27001:2022'
                            : fw === 'ISO27701'
                              ? 'ISO/IEC 27701:2019 (Legacy)'
                              : fw === 'DPDP'
                                ? 'Digital Personal Data Protection (India)'
                                : 'California Consumer Privacy Act'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Controls Selection */}
          {scopeType === 'CONTROLS' && (
            <div className="space-y-2 p-3 rounded-lg border bg-card/50">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Select Controls</Label>
                <span className="text-[11px] text-muted-foreground">
                  {selectedControlIds.length} of {availableControls.length} selected
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {availableControls.map(c => {
                  const isChecked = selectedControlIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleToggleControl(c.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-xs transition-colors ${
                        isChecked
                          ? 'bg-primary/15 text-foreground font-medium'
                          : 'hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      <span className="font-mono text-[11px]">{c.id}</span>
                      <span className="truncate ml-2 text-right">{c.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Evidence Mode */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Evidence Selection
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEvidenceMode('SNAPSHOT')}
                className={`p-2.5 rounded-lg border text-left transition-all text-xs font-medium ${
                  evidenceMode === 'SNAPSHOT'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                    : 'border-border/70 hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="block font-semibold text-foreground">Latest Snapshot</span>
                <span>Most recent telemetry per control</span>
              </button>

              <button
                type="button"
                onClick={() => setEvidenceMode('HISTORICAL')}
                className={`p-2.5 rounded-lg border text-left transition-all text-xs font-medium ${
                  evidenceMode === 'HISTORICAL'
                    ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                    : 'border-border/70 hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="block font-semibold text-foreground">Historical Range</span>
                <span>Bounded observation window</span>
              </button>
            </div>
          </div>

          {/* Historical Range Pickers */}
          {evidenceMode === 'HISTORICAL' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-card/50">
              <div className="space-y-1">
                <Label className="text-xs">From (Observed At)</Label>
                <input
                  type="datetime-local"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border text-xs bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To (Observed At)</Label>
                <input
                  type="datetime-local"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border text-xs bg-background"
                />
              </div>
            </div>
          )}

          {/* Live Count Preview */}
          <div className="p-3 rounded-lg border bg-muted/40 text-xs space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Package Summary Preview
              </span>
              {isLoadingPreview ? (
                <span className="flex items-center gap-1 text-[11px]">
                  <Loader2 className="h-3 w-3 animate-spin" /> Calculating...
                </span>
              ) : (
                <span className="text-[11px] font-mono">
                  ~{preview ? (preview.estimatedSizeBytes / 1024).toFixed(1) : '0'} KB
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="p-2 rounded bg-background border text-center">
                <span className="block text-[11px] text-muted-foreground">Controls</span>
                <span className="text-base font-bold text-foreground">
                  {preview?.counts.controls ?? 0}
                </span>
              </div>
              <div className="p-2 rounded bg-background border text-center">
                <span className="block text-[11px] text-muted-foreground">Requirements</span>
                <span className="text-base font-bold text-foreground">
                  {preview?.counts.requirements ?? 0}
                </span>
              </div>
              <div className="p-2 rounded bg-background border text-center">
                <span className="block text-[11px] text-muted-foreground">Evidence Records</span>
                <span className="text-base font-bold text-foreground">
                  {preview?.counts.evidence ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* Package Inclusions */}
          <div className="text-[11px] text-muted-foreground space-y-1">
            <span className="font-semibold text-foreground block">Verified Package Contents:</span>
            <div className="grid grid-cols-2 gap-1">
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span>Canonical JSON control states</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span>SHA-256 package manifest</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span>Recalculated evidence digests</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span>CSV index & Markdown report</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || (scopeType === 'CONTROLS' && selectedControlIds.length === 0)}
            className="gap-2"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting Archive...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Generate Package
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

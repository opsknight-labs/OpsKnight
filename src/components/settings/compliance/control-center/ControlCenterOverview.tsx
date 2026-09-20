'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { ShieldCheck, Layers, FileCheck2, RefreshCw, Info, Download } from 'lucide-react';
import type { ComplianceControlCenterOverview } from '@/lib/compliance/control-center/types';
import { AttentionRequiredList } from './AttentionRequiredList';
import { SharedResponsibilityCard } from './SharedResponsibilityCard';
import { MonitoringStatusCard, type MonitoringStatusData } from './MonitoringStatusCard';

interface ControlCenterOverviewProps {
  readonly overview: ComplianceControlCenterOverview;
  readonly canEvaluate: boolean;
  readonly isEvaluating: boolean;
  readonly onEvaluate: () => void;
  readonly canExport?: boolean;
  readonly onExport?: () => void;
  readonly onSelectControl: (controlId: string) => void;
  readonly onNavigateToTab: (tab: string) => void;
}

export function ControlCenterOverview({
  overview,
  canEvaluate,
  isEvaluating,
  onEvaluate,
  canExport = false,
  onExport,
  onSelectControl,
  onNavigateToTab,
}: ControlCenterOverviewProps) {
  const { runtime, evidence, frameworks, attention } = overview;
  const [monitoringStatus, setMonitoringStatus] = React.useState<MonitoringStatusData | null>(null);

  const fetchMonitoringStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/compliance/monitoring');
      if (res.ok) {
        const json = await res.json();
        if (json.data) setMonitoringStatus(json.data);
      }
    } catch {
      // Ignore background fetch error
    }
  }, []);

  React.useEffect(() => {
    fetchMonitoringStatus();
  }, [fetchMonitoringStatus]);

  const handleSweepTriggered = () => {
    fetchMonitoringStatus();
    onEvaluate();
  };

  return (
    <div className="space-y-6">
      {/* Top Bar: Action & Timestamp */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card/60 backdrop-blur-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              Continuous Compliance Posture
            </h2>
            <Badge variant="outline" className="text-[11px] font-mono">
              Factual Diagnostics
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Authoritative runtime control telemetry, integrity-verified evidence, and versioned
            framework mappings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground hidden lg:inline">
            Generated: {new Date(overview.generatedAt).toLocaleTimeString()}
          </span>
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              className="gap-2 shrink-0 font-medium"
            >
              <Download className="h-3.5 w-3.5 text-primary" />
              <span>Export Evidence Package</span>
            </Button>
          )}
          {canEvaluate && (
            <Button
              onClick={onEvaluate}
              disabled={isEvaluating}
              size="sm"
              className="gap-2 shrink-0 font-medium"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isEvaluating ? 'animate-spin' : ''}`} />
              <span>{isEvaluating ? 'Evaluating Controls...' : 'Evaluate Runtime Controls'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Primary Metrics Grid (No percentage meters or synthetic scores!) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Runtime Controls */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Runtime Controls
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-sky-500" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-foreground">{runtime.total}</span>
              <span className="text-xs text-muted-foreground">monitored controls</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Implemented:
                </span>
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {runtime.implemented}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Partial:
                </span>
                <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                  {runtime.partial}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  Action Req:
                </span>
                <span className="font-mono font-semibold text-rose-700 dark:text-rose-400">
                  {runtime.actionRequired}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-zinc-400" />
                  Unverified:
                </span>
                <span className="font-mono font-semibold text-zinc-600 dark:text-zinc-400">
                  {runtime.unverified}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Durable Evidence Integrity */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Evidence Ledger
            </CardTitle>
            <FileCheck2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-foreground">
                {evidence.records}
              </span>
              <span className="text-xs text-muted-foreground">durable records</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Recent Sample:</span>
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {evidence.integritySample?.validRecords ?? evidence.verifiedRecords}/
                  {evidence.integritySample?.checkedRecords ?? evidence.verifiedRecords} valid
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Mismatches:</span>
                <span
                  className={`font-mono font-semibold ${
                    (evidence.integritySample?.mismatches ?? evidence.integrityMismatches) > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {evidence.integritySample?.mismatches ?? evidence.integrityMismatches}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Framework Mappings */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Frameworks Mapped
            </CardTitle>
            <Layers className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-foreground">
                {frameworks.count}
              </span>
              <span className="text-xs text-muted-foreground">supported frameworks</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/50">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Active Reqs:</span>
                <span className="font-mono font-semibold text-foreground">
                  {frameworks.activeRequirements}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Future Staged:</span>
                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                  {frameworks.futureRequirements}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Continuous Monitoring Status */}
      <MonitoringStatusCard
        status={monitoringStatus}
        canEvaluate={canEvaluate}
        onSweepTriggered={handleSweepTriggered}
      />

      {/* Attention Required Section */}
      <AttentionRequiredList
        items={attention}
        onSelectControl={onSelectControl}
        onEvaluate={onEvaluate}
        onNavigateToTab={onNavigateToTab}
      />

      {/* Shared Responsibility Explainer */}
      <SharedResponsibilityCard />

      {/* Scope / Non-Certification Disclaimer */}
      <div className="p-4 rounded-xl border border-border/70 bg-muted/20 flex items-start gap-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">
            Architectural Scope & Non-Certification Notice
          </p>
          <p className="leading-relaxed">
            OpsKnight compliance diagnostics evaluate operational and repository technical controls
            against published standards. Mapping a control to a framework requirement indicates that
            OpsKnight captures relevant supporting runtime or repository evidence. It does not
            certify statutory compliance or substitute for independent third-party audit, formal
            certification, or organization-specific legal counsel.
          </p>
        </div>
      </div>
    </div>
  );
}

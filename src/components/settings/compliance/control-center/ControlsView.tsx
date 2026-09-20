'use client';

import React, { useState, useMemo } from 'react';
import { Card } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { Search, Layers, ChevronRight } from 'lucide-react';
import type {
  ComplianceControlCenterControl,
  ControlCenterAssessmentMode,
} from '@/lib/compliance/control-center/types';
import type { ComplianceEvaluationStatus, ComplianceFramework } from '@/lib/compliance/types';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { EvidenceIntegrityBadge } from './EvidenceIntegrityBadge';
import { ControlDetailDrawer } from './ControlDetailDrawer';

interface ControlsViewProps {
  readonly controls: readonly ComplianceControlCenterControl[];
  readonly selectedControlId?: string | null;
  readonly onSelectControl?: (controlId: string | null) => void;
  readonly onNavigateToEvidence?: (controlId: string) => void;
  readonly onNavigateToFramework?: (frameworkId: ComplianceFramework) => void;
}

function getEffectiveControlStatus(
  ctrl: ComplianceControlCenterControl
): ComplianceEvaluationStatus {
  if (ctrl.runtime) return ctrl.runtime.status;
  if (ctrl.legacyStatus === 'IMPLEMENTED') return 'IMPLEMENTED';
  if (ctrl.legacyStatus === 'PARTIAL') return 'PARTIAL';
  return 'ACTION_REQUIRED';
}

export function ControlsView({
  controls,
  selectedControlId,
  onSelectControl,
  onNavigateToEvidence,
  onNavigateToFramework,
}: ControlsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<ControlCenterAssessmentMode | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<ComplianceEvaluationStatus | 'ALL'>('ALL');
  const [activeDrawerControl, setActiveDrawerControl] =
    useState<ComplianceControlCenterControl | null>(null);

  // Sync external selectedControlId prop if provided
  React.useEffect(() => {
    if (selectedControlId) {
      const found = controls.find(c => c.controlId === selectedControlId);
      if (found) setActiveDrawerControl(found);
    }
  }, [selectedControlId, controls]);

  const filteredControls = useMemo(() => {
    return controls.filter(ctrl => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = ctrl.controlId.toLowerCase().includes(q);
        const matchesTitle = ctrl.title.toLowerCase().includes(q);
        const matchesDesc = ctrl.description.toLowerCase().includes(q);
        const matchesCategory = ctrl.category.toLowerCase().includes(q);
        if (!matchesId && !matchesTitle && !matchesDesc && !matchesCategory) return false;
      }

      // Assessment Mode
      if (modeFilter !== 'ALL' && ctrl.assessmentMode !== modeFilter) {
        return false;
      }

      // Status
      if (statusFilter !== 'ALL') {
        const currentStatus = getEffectiveControlStatus(ctrl);
        if (currentStatus !== statusFilter) return false;
      }

      return true;
    });
  }, [controls, searchQuery, modeFilter, statusFilter]);

  const handleOpenControl = (ctrl: ComplianceControlCenterControl) => {
    setActiveDrawerControl(ctrl);
    if (onSelectControl) onSelectControl(ctrl.controlId);
  };

  const handleCloseDrawer = () => {
    setActiveDrawerControl(null);
    if (onSelectControl) onSelectControl(null);
  };

  return (
    <div className="space-y-4">
      {/* Controls Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3.5 rounded-xl border bg-card/60">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, title, description, or category..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 bg-background/80"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Assessment Mode Selector */}
          <div className="flex items-center rounded-lg border bg-background/80 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setModeFilter('ALL')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                modeFilter === 'ALL'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Modes
            </button>
            <button
              type="button"
              onClick={() => setModeFilter('RUNTIME')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                modeFilter === 'RUNTIME'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Runtime
            </button>
            <button
              type="button"
              onClick={() => setModeFilter('REPOSITORY')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                modeFilter === 'REPOSITORY'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Repository
            </button>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ComplianceEvaluationStatus | 'ALL')}
            aria-label="Filter controls by status"
            className="h-9 px-3 py-1 rounded-lg border bg-background/80 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="ALL">All Statuses</option>
            <option value="IMPLEMENTED">Implemented</option>
            <option value="PARTIAL">Partial</option>
            <option value="ACTION_REQUIRED">Action Required</option>
            <option value="UNVERIFIED">Unverified</option>
          </select>
        </div>
      </div>

      {/* Control Results Header */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          Showing {filteredControls.length} of {controls.length} controls
        </span>
      </div>

      {/* Controls List / Table */}
      {filteredControls.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground">No controls match the selected filters.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {filteredControls.map(ctrl => {
            const isRuntime = ctrl.assessmentMode === 'RUNTIME';
            const status = getEffectiveControlStatus(ctrl);

            return (
              <div
                key={ctrl.controlId}
                onClick={() => handleOpenControl(ctrl)}
                className="p-4 rounded-xl border border-border/80 bg-card hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 group"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/60">
                      {ctrl.controlId}
                    </span>
                    <Badge variant="outline" className="text-[11px] py-0">
                      {ctrl.category}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] py-0 ${
                        isRuntime
                          ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
                          : 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-400'
                      }`}
                    >
                      {isRuntime ? 'Runtime' : 'Repository'}
                    </Badge>
                  </div>

                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {ctrl.title}
                  </h3>

                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {ctrl.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                    {ctrl.frameworkMappings.length > 0 && (
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Layers className="h-3 w-3 text-purple-500" />
                        {ctrl.frameworkMappings.length} framework requirement(s)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  <div className="flex flex-col items-end gap-1.5">
                    <RuntimeStatusBadge status={status} />
                    <EvidenceIntegrityBadge
                      integrity={ctrl.evidence.integrity}
                      count={ctrl.evidence.count}
                    />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      <ControlDetailDrawer
        control={activeDrawerControl}
        isOpen={Boolean(activeDrawerControl)}
        onClose={handleCloseDrawer}
        onNavigateToEvidence={onNavigateToEvidence}
        onNavigateToFramework={onNavigateToFramework}
      />
    </div>
  );
}

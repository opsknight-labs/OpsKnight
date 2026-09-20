'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Activity, SlidersHorizontal, Layers, FileCheck2, Key } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { notify } from '@/lib/toast';
import type { ComplianceControlCenterOverview } from '@/lib/compliance/control-center/types';
import { ControlCenterOverview } from './ControlCenterOverview';
import { ControlsView } from './ControlsView';
import { FrameworksView, type FrameworkCardItem } from './FrameworksView';
import { EvidenceView } from './EvidenceView';
import { OperationsView } from './OperationsView';
import { ExportEvidencePackageModal } from './ExportEvidencePackageModal';

export interface ComplianceCapabilities {
  readonly canEvaluate: boolean;
  readonly canReadEvidence: boolean;
  readonly canExport?: boolean;
  readonly canReadEncryption: boolean;
  readonly canManageEncryption: boolean;
  readonly canReadPrivacy: boolean;
  readonly canReadRetention: boolean;
}

interface ComplianceControlCenterProps {
  readonly initialData: ComplianceControlCenterOverview;
  readonly frameworks: readonly FrameworkCardItem[];
  readonly capabilities: ComplianceCapabilities;
  readonly initialTab?: 'overview' | 'controls' | 'frameworks' | 'evidence' | 'operations';
}

export function ComplianceControlCenter({
  initialData,
  frameworks,
  capabilities,
  initialTab = 'overview',
}: ComplianceControlCenterProps) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'controls' | 'frameworks' | 'evidence' | 'operations'
  >(initialTab);

  const [overviewData, setOverviewData] = useState<ComplianceControlCenterOverview>(initialData);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [evidenceControlFilter, setEvidenceControlFilter] = useState<string | null>(null);
  const router = useRouter();

  const handleEvaluateControls = async () => {
    setIsEvaluating(true);
    try {
      const res = await fetch('/api/compliance/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to evaluate controls');
      }

      notify.success('Runtime controls evaluated successfully');
      router.refresh();

      // Refresh client overview state
      const freshRes = await fetch('/api/compliance/control-center');
      if (freshRes.ok) {
        const json = await freshRes.json();
        if (json.data) {
          setOverviewData(json.data);
        }
      }
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleSelectControl = (controlId: string) => {
    setSelectedControlId(controlId);
    setActiveTab('controls');
  };

  const handleNavigateToEvidence = (controlId: string) => {
    setEvidenceControlFilter(controlId);
    setActiveTab('evidence');
  };

  const tabs = [
    {
      id: 'overview' as const,
      label: 'Overview',
      icon: Activity,
      badge: overviewData.attention.length > 0 ? `${overviewData.attention.length}` : undefined,
      badgeVariant: 'destructive' as const,
    },
    {
      id: 'controls' as const,
      label: 'Controls',
      icon: SlidersHorizontal,
      badge: `${overviewData.controls.length}`,
    },
    {
      id: 'frameworks' as const,
      label: 'Frameworks',
      icon: Layers,
      badge: `${frameworks.length}`,
    },
    {
      id: 'evidence' as const,
      label: 'Evidence Ledger',
      icon: FileCheck2,
      badge: `${overviewData.evidence.records}`,
    },
    {
      id: 'operations' as const,
      label: 'Operations',
      icon: Key,
    },
  ];

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Canonical DetailHeroBanner */}
      <DetailHeroBanner
        tag="Security Posture & Compliance Engine"
        title="Compliance Control Center"
        subtitle="Continuous runtime control telemetry, integrity-verified evidence, and versioned regulatory mapping."
        icon={
          <div className="p-3 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/20 shadow-inner">
            <ShieldCheck className="h-7 w-7" />
          </div>
        }
        badges={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs font-semibold"
            >
              Runtime Implemented: {overviewData.runtime.implemented}/{overviewData.runtime.total}
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Authoritative
            </Badge>
          </div>
        }
      />

      {/* Primary Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-border/80 pb-px overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 whitespace-nowrap ${
                isActive
                  ? 'border-primary text-foreground bg-card'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    tab.badgeVariant === 'destructive'
                      ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === 'overview' && (
          <ControlCenterOverview
            overview={overviewData}
            canEvaluate={capabilities.canEvaluate}
            isEvaluating={isEvaluating}
            onEvaluate={handleEvaluateControls}
            canExport={capabilities.canExport}
            onExport={() => setIsExportModalOpen(true)}
            onSelectControl={handleSelectControl}
            onNavigateToTab={tab => setActiveTab(tab as typeof activeTab)}
          />
        )}

        {activeTab === 'controls' && (
          <ControlsView
            controls={overviewData.controls}
            selectedControlId={selectedControlId}
            onSelectControl={setSelectedControlId}
            onNavigateToEvidence={handleNavigateToEvidence}
          />
        )}

        {activeTab === 'frameworks' && <FrameworksView frameworks={frameworks} />}

        {activeTab === 'evidence' && (
          <EvidenceView
            initialControlFilter={evidenceControlFilter}
            onClearControlFilter={() => setEvidenceControlFilter(null)}
            canReadEvidence={capabilities.canReadEvidence}
          />
        )}

        {activeTab === 'operations' && (
          <OperationsView
            canManageEncryption={capabilities.canManageEncryption}
            canReadEncryption={capabilities.canReadEncryption}
            retentionPolicy={overviewData.retentionPolicy}
          />
        )}
      </div>

      <ExportEvidencePackageModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        availableControls={overviewData.controls.map(c => ({ id: c.controlId, title: c.title }))}
      />
    </div>
  );
}

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  ShieldCheck,
  Shield,
  CheckCircle2,
  TriangleAlert,
  CircleDashed,
  Search,
  ExternalLink,
  Layers,
  Lock,
  FileCode,
  ShieldAlert,
  Activity,
  SlidersHorizontal,
  Database,
  Key,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import type {
  ComplianceControl,
  ControlStatus,
  ComplianceFramework,
  ComplianceEvaluationStatus,
} from '@/lib/compliance/types';
import type { PersonalDataDomain } from '@/lib/privacy/types';
import type { ComplianceEvidenceRecord } from '@/lib/compliance/evidence/types';
import { EncryptionMigrationPanel } from './EncryptionMigrationPanel';
import { ComplianceEvidenceViewer } from './ComplianceEvidenceViewer';
import { useRouter } from 'next/navigation';
import { notify } from '@/lib/toast';

const statusPresentation: Record<
  ControlStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  IMPLEMENTED: {
    label: 'Implemented',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  PARTIAL: {
    label: 'Partial',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: TriangleAlert,
  },
  MISSING: {
    label: 'Missing',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    icon: CircleDashed,
  },
};

const runtimeStatusPresentation: Record<
  ComplianceEvaluationStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  IMPLEMENTED: {
    label: 'Implemented',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  PARTIAL: {
    label: 'Partial',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: TriangleAlert,
  },
  ACTION_REQUIRED: {
    label: 'Action Required',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    icon: ShieldAlert,
  },
  UNVERIFIED: {
    label: 'Unverified',
    className: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
    icon: CircleDashed,
  },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
    icon: CircleDashed,
  },
};

type FrameworkItem = {
  id: ComplianceFramework;
  title: string;
  scope: string;
  source: string;
  counts: Record<ControlStatus, number>;
};

type UserOption = {
  id: string;
  name: string | null;
  email: string;
  status: string;
};

type SubjectDiscoveryData = {
  readonly subjectUserId: string;
  readonly generatedAt: string;
  readonly counts: Record<string, number>;
  readonly limitations: readonly string[];
} | null;

export type ControlStateItem = {
  controlId: string;
  status: ComplianceEvaluationStatus;
  latestEvaluationId: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatedAt: string;
  validUntil: string | null;
  summary: string;
};

type Props = {
  overall: Record<ControlStatus, number>;
  frameworks: FrameworkItem[];
  controls: readonly ComplianceControl[];
  personalDataRegistry: readonly PersonalDataDomain[];
  controlStates?: ControlStateItem[];
  canEvaluate?: boolean;
  privacyData: {
    users: UserOption[];
    userCount: number;
    selectedUser: { id: string; name: string | null; email: string } | null;
    discovery: SubjectDiscoveryData;
    query: string;
    page: number;
    pageCount: number;
    userId?: string;
  };
};

export default function ComplianceClientTabs({
  overall,
  frameworks,
  controls,
  personalDataRegistry,
  controlStates = [],
  canEvaluate = false,
  privacyData,
}: Props) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'security' | 'privacy' | 'encryption' | 'cra' | 'evidence'
  >(privacyData.userId || privacyData.query ? 'privacy' : 'overview');
  const [statusFilter, setStatusFilter] = useState<ControlStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const totalControls = overall.IMPLEMENTED + overall.PARTIAL + overall.MISSING;

  const [isEvaluating, setIsEvaluating] = useState(false);
  const router = useRouter();

  const stateMap = useMemo(
    () => new Map(controlStates.map(s => [s.controlId, s])),
    [controlStates]
  );

  const runtimeControls = useMemo(
    () => controls.filter(c => c.assessmentMode === 'RUNTIME'),
    [controls]
  );

  const runtimeStats = useMemo(() => {
    let implemented = 0;
    let partial = 0;
    let actionRequired = 0;
    let unverified = 0;

    for (const c of runtimeControls) {
      const s = stateMap.get(c.id);
      if (!s) {
        unverified++;
      } else if (s.status === 'IMPLEMENTED') {
        implemented++;
      } else if (s.status === 'PARTIAL') {
        partial++;
      } else if (s.status === 'ACTION_REQUIRED') {
        actionRequired++;
      } else {
        unverified++;
      }
    }

    return {
      total: runtimeControls.length,
      implemented,
      partial,
      actionRequired,
      unverified,
    };
  }, [runtimeControls, stateMap]);

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
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setIsEvaluating(false);
    }
  };

  const [selectedEvidence, setSelectedEvidence] = useState<ComplianceEvidenceRecord | null>(null);
  const [isEvidenceViewerOpen, setIsEvidenceViewerOpen] = useState(false);
  const [runtimeEvidenceList, setRuntimeEvidenceList] = useState<ComplianceEvidenceRecord[]>([]);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [evidenceCursor, setEvidenceCursor] = useState<string | null>(null);
  const [hasMoreEvidence, setHasMoreEvidence] = useState(false);
  const [isLoadingMoreEvidence, setIsLoadingMoreEvidence] = useState(false);
  const [evidenceTypeFilter, setEvidenceTypeFilter] = useState<string>('ALL');
  const [evidenceSearchQuery, setEvidenceSearchQuery] = useState('');

  const fetchEvidence = async () => {
    setIsLoadingEvidence(true);
    try {
      const res = await fetch('/api/compliance/evidence?limit=50');
      const json = await res.json();
      if (res.ok && json.data?.evidence) {
        setRuntimeEvidenceList(json.data.evidence);
        setEvidenceCursor(json.data.nextCursor ?? null);
        setHasMoreEvidence(Boolean(json.data.hasMore));
      }
    } catch {
      // Ignore network errors
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  const loadMoreEvidence = async () => {
    if (!evidenceCursor || isLoadingMoreEvidence) return;
    setIsLoadingMoreEvidence(true);
    try {
      const res = await fetch(
        `/api/compliance/evidence?limit=50&cursor=${encodeURIComponent(evidenceCursor)}`
      );
      const json = await res.json();
      if (res.ok && json.data?.evidence) {
        setRuntimeEvidenceList(prev => [...prev, ...json.data.evidence]);
        setEvidenceCursor(json.data.nextCursor ?? null);
        setHasMoreEvidence(Boolean(json.data.hasMore));
      }
    } catch {
      // Ignore network errors
    } finally {
      setIsLoadingMoreEvidence(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'evidence') {
      fetchEvidence();
    }
  }, [activeTab]);

  const inspectControlEvidence = async (controlId: string) => {
    try {
      const res = await fetch(`/api/compliance/controls/${controlId}/evidence?limit=1`);
      const json = await res.json();
      if (res.ok && json.data?.evidence?.length > 0) {
        setSelectedEvidence(json.data.evidence[0]);
        setIsEvidenceViewerOpen(true);
      } else {
        notify.info(`No runtime evidence snapshots found for ${controlId}`);
      }
    } catch {
      notify.error('Failed to load control evidence');
    }
  };

  const filteredRuntimeEvidence = useMemo(() => {
    return runtimeEvidenceList.filter(item => {
      if (evidenceTypeFilter !== 'ALL' && item.type !== evidenceTypeFilter) {
        return false;
      }
      if (evidenceSearchQuery) {
        const q = evidenceSearchQuery.toLowerCase();
        return (
          item.controlId.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.collectorId.toLowerCase().includes(q) ||
          item.contentHash.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [runtimeEvidenceList, evidenceTypeFilter, evidenceSearchQuery]);

  // Filtered security controls
  const securityControls = useMemo(() => {
    return controls.filter(c => {
      if (!c.id.startsWith('SEC-')) return false;
      const s = stateMap.get(c.id);
      const effectiveStatus =
        c.assessmentMode === 'RUNTIME' && s ? s.status : (c.catalogStatus ?? c.status);
      if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          c.id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.implementation.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [controls, statusFilter, searchQuery, stateMap]);

  // CRA controls
  const craControls = useMemo(() => {
    return controls.filter(c => c.frameworks.includes('CRA'));
  }, [controls]);

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Canonical DetailHeroBanner */}
      <DetailHeroBanner
        tag="Security Posture & Compliance Frameworks"
        title="Security & Compliance"
        subtitle="Read-only readiness diagnostics across SOC 2, ISO 27001, HIPAA, GDPR, CRA, and workspace security controls."
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
              Repository Baseline: {overall.IMPLEMENTED}/{totalControls}
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-bold uppercase tracking-wider"
            >
              Enterprise Governance
            </Badge>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
            >
              <Link href="/audit">
                <Activity className="h-3.5 w-3.5" />
                Audit Log
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground border-primary-foreground/20 text-xs font-semibold h-8 shadow-xs"
            >
              <Link href="/settings">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Settings Hub
              </Link>
            </Button>
          </div>
        }
        stats={[
          {
            label: 'Baseline Implemented',
            value: `${overall.IMPLEMENTED} of ${totalControls}`,
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            subtext: 'Repository baseline claims',
          },
          {
            label: 'Baseline Partial',
            value: `${overall.PARTIAL}`,
            icon: <TriangleAlert className="h-3.5 w-3.5" />,
            subtext: 'Identified catalog gaps',
          },
          {
            label: 'Baseline Missing',
            value: `${overall.MISSING}`,
            icon: <CircleDashed className="h-3.5 w-3.5" />,
            subtext: 'Unaddressed features',
          },
          {
            label: 'Frameworks',
            value: `${frameworks.length} Frameworks`,
            icon: <Layers className="h-3.5 w-3.5" />,
            subtext: 'Catalogued standards',
          },
        ]}
        alert={
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-foreground">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">Read-only readiness diagnostics.</strong> This
              dashboard displays architectural security controls and gap analyses. It does not
              constitute a formal audit certification or legal conclusions.
            </p>
          </div>
        }
      />

      {/* Segmented Sub-Navigation Switcher (Modern Pill Style) */}
      <div className="bg-card border border-border/70 p-1 rounded-xl inline-flex gap-1 shadow-xs overflow-x-auto max-w-full">
        {[
          { id: 'overview', label: 'Frameworks Overview', icon: Layers },
          {
            id: 'security',
            label: `Security Controls (${controls.filter(c => c.id.startsWith('SEC-')).length})`,
            icon: ShieldCheck,
          },
          { id: 'privacy', label: 'Privacy & DSR', icon: Lock },
          { id: 'encryption', label: 'Encryption & Keys', icon: Key },
          { id: 'cra', label: `CRA Readiness (${craControls.length})`, icon: Shield },
          { id: 'evidence', label: 'Evidence Catalog', icon: FileCode },
        ].map(tab => {
          const isActive = activeTab === tab.id;
          const TabIcon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all select-none whitespace-nowrap',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              <TabIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}

        <a
          href="/settings/system"
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium border border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all ml-auto shrink-0"
        >
          <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>Data Lifecycle &amp; Retention</span>
          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
        </a>
      </div>

      {/* TAB 1: FRAMEWORKS OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {frameworks.map(fw => {
              const total = fw.counts.IMPLEMENTED + fw.counts.PARTIAL + fw.counts.MISSING;

              return (
                <div
                  key={fw.id}
                  className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 flex flex-col justify-between shadow-xs hover:border-primary/40 transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                          <Shield className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm text-foreground">{fw.title}</h3>
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">
                            {fw.id}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[11px] font-mono font-bold bg-muted/40"
                      >
                        Repository Baseline: {fw.counts.IMPLEMENTED}/{total}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 line-clamp-2 leading-relaxed">
                      {fw.scope}
                    </p>

                    <div className="grid grid-cols-3 gap-1.5 mt-3.5 pt-3 border-t border-border/50 text-center">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <p className="text-[10px] font-semibold uppercase">Done</p>
                        <p className="text-xs font-bold mt-0.5">{fw.counts.IMPLEMENTED}</p>
                      </div>
                      <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <p className="text-[10px] font-semibold uppercase">Partial</p>
                        <p className="text-xs font-bold mt-0.5">{fw.counts.PARTIAL}</p>
                      </div>
                      <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                        <p className="text-[10px] font-semibold uppercase">Missing</p>
                        <p className="text-xs font-bold mt-0.5">{fw.counts.MISSING}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/50">
                    <a
                      href={fw.source}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-semibold"
                    >
                      <span>Official Specification</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: SECURITY CONTROLS */}
      {activeTab === 'security' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          {/* Runtime Control State Overview Section */}
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-foreground">Runtime Control State</h3>
                  <Badge variant="outline" className="text-xs font-mono font-semibold">
                    {runtimeStats.total} runtime controls
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Dynamic readiness evaluated directly against deployment encryption, retention,
                  privacy, and authorization states.
                </p>
              </div>
              {canEvaluate && (
                <Button
                  onClick={handleEvaluateControls}
                  disabled={isEvaluating}
                  size="sm"
                  className="font-semibold shadow-xs shrink-0"
                >
                  <Activity className={cn('h-4 w-4 mr-1.5', isEvaluating && 'animate-spin')} />
                  {isEvaluating ? 'Evaluating Controls...' : 'Evaluate Controls'}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Implemented
                </div>
                <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-300 mt-0.5">
                  {runtimeStats.implemented}
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  Partial
                </div>
                <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-300 mt-0.5">
                  {runtimeStats.partial}
                </div>
              </div>
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  Action Required
                </div>
                <div className="text-xl font-bold font-mono text-rose-700 dark:text-rose-300 mt-0.5">
                  {runtimeStats.actionRequired}
                </div>
              </div>
              <div className="rounded-xl border border-slate-500/20 bg-slate-500/5 p-3">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Unverified
                </div>
                <div className="text-xl font-bold font-mono text-slate-700 dark:text-slate-300 mt-0.5">
                  {runtimeStats.unverified}
                </div>
              </div>
            </div>
          </div>

          {/* Controls Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search controls by ID, title, or implementation..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {(['ALL', 'IMPLEMENTED', 'PARTIAL', 'MISSING'] as const).map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'px-3 py-1 rounded-lg text-xs font-semibold transition-all select-none',
                    statusFilter === status
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'border border-border/70 bg-card/80 text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Controls List */}
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs overflow-hidden divide-y divide-border/50 shadow-xs">
            {securityControls.map(control => {
              const runtimeState = stateMap.get(control.id);
              const isRuntime = control.assessmentMode === 'RUNTIME';
              const presentation =
                isRuntime && runtimeState
                  ? runtimeStatusPresentation[runtimeState.status]
                  : isRuntime
                    ? runtimeStatusPresentation['UNVERIFIED']
                    : statusPresentation[control.catalogStatus ?? control.status];
              const StatusIcon = presentation.icon;

              return (
                <div
                  key={control.id}
                  className="p-4 sm:p-5 space-y-2.5 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                        {control.id}
                      </span>
                      <h3 className="font-bold text-sm text-foreground">{control.title}</h3>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-xs font-semibold px-2.5 py-0.5', presentation.className)}
                    >
                      <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
                      {presentation.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {control.implementation}
                  </p>
                  {isRuntime ? (
                    <div className="pt-1">
                      {runtimeState ? (
                        <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                              <Activity className="h-3.5 w-3.5 text-primary" />
                              Runtime Evaluated
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono">
                                {new Date(runtimeState.evaluatedAt).toLocaleString()}
                              </span>
                              <button
                                type="button"
                                onClick={() => inspectControlEvidence(control.id)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                              >
                                <ShieldCheck className="h-3 w-3" />
                                Inspect Evidence
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-foreground/90 font-medium">
                            {runtimeState.summary}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-slate-500/5 border border-slate-500/20 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
                          <CircleDashed className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>
                            Runtime evaluation pending. Click <strong>Evaluate Controls</strong>{' '}
                            above to evaluate deployment state.
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-muted/30 border border-border/50 px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="font-semibold text-foreground/80">
                        Repository baseline: {control.catalogStatus ?? control.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Not evaluated at runtime · Operator evidence required
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-semibold text-foreground">Owner:</span>{' '}
                      <Badge variant="outline" className="text-[10px] font-mono capitalize py-0">
                        {control.owner.toLowerCase()}
                      </Badge>
                    </span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-foreground">Frameworks:</span>
                      {control.frameworks.map(fw => (
                        <Badge key={fw} variant="secondary" className="text-[10px] font-mono py-0">
                          {fw}
                        </Badge>
                      ))}
                    </span>
                  </div>
                  {control.gaps.length > 0 && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-300 mt-2 space-y-1">
                      <span className="font-bold flex items-center gap-1.5">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        Remaining Gap
                      </span>
                      <p className="text-xs leading-relaxed">{control.gaps.join(' ')}</p>
                    </div>
                  )}
                </div>
              );
            })}
            {securityControls.length === 0 && (
              <div className="p-10 text-center text-xs text-muted-foreground">
                No controls match the selected filter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PRIVACY & DSR */}
      {activeTab === 'privacy' && (
        <div className="space-y-6 animate-in fade-in-50 duration-150">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Registry Card */}
            <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-3 border-b border-border/60 pb-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                  <Lock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Personal Data Registry</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Catalogued customer and employee personally identifiable information (PII)
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {personalDataRegistry.map(domain => (
                  <div
                    key={domain.domain}
                    className="rounded-xl border border-border/60 p-3.5 text-xs bg-muted/20 space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-foreground font-bold">{domain.domain}</strong>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {domain.discoverable.toLowerCase().replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{domain.purpose.join(' · ')}</p>
                    <p className="text-[11px] pt-0.5">
                      <span className="font-semibold text-foreground">Retention Policy:</span>{' '}
                      <span className="text-muted-foreground">{domain.retention.current}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Subject Discovery Tool */}
            <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-3 border-b border-border/60 pb-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                  <Search className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Subject Discovery & DSR</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Execute GDPR Article 15 and CCPA data subject access requests across relational
                    storage
                  </p>
                </div>
              </div>

              <form method="get" action="/settings/security-compliance" className="space-y-3">
                <div className="flex gap-2">
                  <input
                    name="q"
                    type="search"
                    defaultValue={privacyData.query}
                    placeholder="Search workspace user..."
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-lg border border-border bg-muted/50 hover:bg-muted text-xs font-semibold text-foreground shadow-2xs"
                  >
                    Filter
                  </button>
                </div>

                <div className="flex gap-2">
                  <select
                    name="userId"
                    defaultValue={privacyData.userId ?? ''}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    <option value="">Select a user for DSR summary</option>
                    {privacyData.users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name || 'Unnamed'} — {u.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-2xs"
                  >
                    Discover
                  </button>
                </div>
              </form>

              {privacyData.discovery && (
                <div className="space-y-3 pt-3.5 border-t border-border/50">
                  <p className="text-xs font-bold text-foreground">
                    Direct relations discovered for:{' '}
                    <span className="text-primary font-semibold">
                      {privacyData.selectedUser
                        ? `${privacyData.selectedUser.name || 'User'} (${privacyData.selectedUser.email})`
                        : privacyData.discovery.subjectUserId}
                    </span>
                  </p>
                  <div className="grid gap-2 grid-cols-2">
                    {Object.entries(privacyData.discovery.counts).map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs"
                      >
                        <span className="text-muted-foreground truncate">{label}</span>
                        <strong className="text-foreground font-bold">{value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CRA READINESS */}
      {activeTab === 'cra' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs overflow-hidden divide-y divide-border/50 shadow-xs">
            {craControls.map(control => {
              const runtimeState = stateMap.get(control.id);
              const isRuntime = control.assessmentMode === 'RUNTIME';
              const presentation =
                isRuntime && runtimeState
                  ? runtimeStatusPresentation[runtimeState.status]
                  : isRuntime
                    ? runtimeStatusPresentation['UNVERIFIED']
                    : statusPresentation[control.catalogStatus ?? control.status];
              const StatusIcon = presentation.icon;

              return (
                <div
                  key={control.id}
                  className="p-4 sm:p-5 space-y-2.5 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                        {control.id}
                      </span>
                      <h3 className="font-bold text-sm text-foreground">{control.title}</h3>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-xs font-semibold px-2.5 py-0.5', presentation.className)}
                    >
                      <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
                      {presentation.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {control.implementation}
                  </p>
                  {isRuntime ? (
                    <div className="pt-1">
                      {runtimeState ? (
                        <div className="rounded-xl bg-muted/40 border border-border/60 p-3 text-xs space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                              <Activity className="h-3.5 w-3.5 text-primary" />
                              Runtime Evaluated
                            </span>
                            <span className="font-mono">
                              {new Date(runtimeState.evaluatedAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-foreground/90 font-medium">
                            {runtimeState.summary}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-slate-500/5 border border-slate-500/20 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
                          <CircleDashed className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>Runtime evaluation pending.</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-muted/30 border border-border/50 px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="font-semibold text-foreground/80">
                        Repository baseline: {control.catalogStatus ?? control.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Not evaluated at runtime · Operator evidence required
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB: ENCRYPTION & KEY RETIREMENT */}
      {activeTab === 'encryption' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <EncryptionMigrationPanel />
        </div>
      )}

      {/* TAB 5: EVIDENCE CATALOG */}
      {activeTab === 'evidence' && (
        <div className="space-y-6 animate-in fade-in-50 duration-150">
          {/* Main Card */}
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 shadow-xs space-y-6">
            <div className="flex items-center gap-3 border-b border-border/60 pb-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <FileCode className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Verified Evidence Catalog</h3>
                <p className="text-[11px] text-muted-foreground">
                  Cryptographically hashed operational evidence and repository compliance contracts
                </p>
              </div>
            </div>

            {/* SECTION 1: RUNTIME AUTOMATED EVIDENCE */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-bold text-foreground">Automated Runtime Evidence</h4>
                  <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                    {runtimeEvidenceList.length} snapshots
                  </Badge>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  SHA-256 canonical digests generated during control evaluations
                </span>
              </div>

              {/* Search and Filters */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={evidenceSearchQuery}
                    onChange={e => setEvidenceSearchQuery(e.target.value)}
                    placeholder="Search evidence by control, title, hash..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>

                <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
                  {[
                    'ALL',
                    'VERIFICATION_RESULT',
                    'CONFIGURATION_SNAPSHOT',
                    'SYSTEM_STATE',
                    'CAPABILITY_CHECK',
                    'EXECUTION_SUMMARY',
                    'EVALUATION_FAILURE',
                  ].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setEvidenceTypeFilter(type)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap select-none',
                        evidenceTypeFilter === type
                          ? 'bg-primary text-primary-foreground shadow-xs'
                          : 'border border-border/70 bg-card/80 text-muted-foreground hover:text-foreground hover:bg-muted/40'
                      )}
                    >
                      {type.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {isLoadingEvidence ? (
                <div className="p-10 text-center text-xs text-muted-foreground">
                  Loading runtime evidence snapshots...
                </div>
              ) : filteredRuntimeEvidence.length > 0 ? (
                <div className="rounded-xl border border-border/60 divide-y divide-border/40 overflow-hidden">
                  {filteredRuntimeEvidence.map(item => (
                    <div
                      key={item.id}
                      className="p-3.5 hover:bg-muted/20 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-primary text-[11px] px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                            {item.controlId}
                          </span>
                          <Badge variant="outline" className="text-[10px] font-semibold">
                            {item.type.replace(/_/g, ' ')}
                          </Badge>
                          <span className="font-semibold text-foreground truncate">
                            {item.title}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>
                            Collector: {item.collectorId} (v{item.collectorVersion})
                          </span>
                          <span>·</span>
                          <span>Observed: {new Date(item.observedAt).toLocaleString()}</span>
                          <span>·</span>
                          <span className="font-mono text-[10px] bg-muted/50 px-1.5 py-0.5 rounded border border-border/40">
                            {item.contentHash.slice(0, 18)}…
                          </span>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedEvidence(item);
                          setIsEvidenceViewerOpen(true);
                        }}
                        className="h-7 text-xs font-semibold px-3 shrink-0 gap-1.5"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                        Inspect Evidence
                      </Button>
                    </div>
                  ))}

                  {hasMoreEvidence && (
                    <div className="p-3 bg-muted/10 text-center border-t border-border/40">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadMoreEvidence}
                        disabled={isLoadingMoreEvidence}
                        className="text-xs font-semibold h-8 px-4"
                      >
                        {isLoadingMoreEvidence ? 'Loading more evidence...' : 'Load More Evidence'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/80 p-6 text-center space-y-2 bg-muted/10">
                  <ShieldCheck className="h-7 w-7 text-muted-foreground mx-auto" />
                  <p className="text-xs font-medium text-foreground">
                    No runtime evidence records found
                  </p>
                  <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                    Runtime evaluators collect verifiable, SHA-256 hashed snapshots during
                    evaluation runs. Click <strong>Evaluate Controls</strong> in the Security tab to
                    trigger inspection.
                  </p>
                </div>
              )}
            </div>

            {/* SECTION 2: REPOSITORY BASELINE CONTRACTS */}
            <div className="space-y-4 pt-5 border-t border-border/60">
              <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-bold text-foreground">
                    Repository Baseline Artifacts
                  </h4>
                  <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                    {controls.length} controls
                  </Badge>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Static repository implementation artifacts and source contracts
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {controls.map(control => (
                  <div
                    key={control.id}
                    className="p-3.5 rounded-xl border border-border/60 bg-muted/20 text-xs space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-primary text-[11px]">
                        {control.id}
                      </span>
                      <span className="font-semibold text-foreground truncate">
                        {control.title}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(control.evidence ?? []).map(path => (
                        <span
                          key={path}
                          className="rounded-md border border-border/70 bg-background px-2 py-0.5 font-mono text-[10px] text-primary"
                        >
                          {path}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compliance Evidence Modal Viewer */}
      <ComplianceEvidenceViewer
        evidence={selectedEvidence}
        isOpen={isEvidenceViewerOpen}
        onClose={() => setIsEvidenceViewerOpen(false)}
      />
    </div>
  );
}

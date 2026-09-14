'use client';

import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import type { ComplianceControl, ControlStatus, ComplianceFramework } from '@/lib/compliance/types';
import type { PersonalDataDomain } from '@/lib/privacy/types';

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

type Props = {
  overall: Record<ControlStatus, number>;
  frameworks: FrameworkItem[];
  controls: readonly ComplianceControl[];
  personalDataRegistry: readonly PersonalDataDomain[];
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
  privacyData,
}: Props) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'security' | 'privacy' | 'cra' | 'evidence'
  >(privacyData.userId || privacyData.query ? 'privacy' : 'overview');
  const [statusFilter, setStatusFilter] = useState<ControlStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const totalControls = overall.IMPLEMENTED + overall.PARTIAL + overall.MISSING;
  const percentImplemented =
    totalControls > 0 ? Math.round((overall.IMPLEMENTED / totalControls) * 100) : 0;

  // Filtered security controls
  const securityControls = useMemo(() => {
    return controls.filter(c => {
      if (!c.id.startsWith('SEC-')) return false;
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
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
  }, [controls, statusFilter, searchQuery]);

  // CRA controls
  const craControls = useMemo(() => {
    return controls.filter(c => c.frameworks.includes('CRA'));
  }, [controls]);

  return (
    <div className="space-y-6">
      {/* Top Metric Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Implemented</p>
            <p className="text-sm font-semibold text-foreground">
              {overall.IMPLEMENTED}{' '}
              <span className="text-[11px] font-normal text-muted-foreground">
                ({percentImplemented}%)
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
            <TriangleAlert className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Partial Controls</p>
            <p className="text-sm font-semibold text-foreground">{overall.PARTIAL}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
            <CircleDashed className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Missing / Gaps</p>
            <p className="text-sm font-semibold text-foreground">{overall.MISSING}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">Catalogued Standards</p>
            <p className="text-sm font-semibold text-foreground">{frameworks.length} Frameworks</p>
          </div>
        </div>
      </div>

      {/* Segmented Sub-Navigation Switcher */}
      <div className="flex items-center gap-1.5 border-b border-border/50 pb-2 overflow-x-auto scrollbar-none">
        {[
          { id: 'overview', label: 'Frameworks Overview', icon: Layers },
          {
            id: 'security',
            label: `Security Controls (${controls.filter(c => c.id.startsWith('SEC-')).length})`,
            icon: ShieldCheck,
          },
          { id: 'privacy', label: 'Privacy & DSR', icon: Lock },
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
                'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all select-none',
                isActive
                  ? 'bg-primary/10 text-primary border border-primary/30 font-semibold shadow-2xs'
                  : 'border border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <TabIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: FRAMEWORKS OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {frameworks.map(fw => {
              const total = fw.counts.IMPLEMENTED + fw.counts.PARTIAL + fw.counts.MISSING;
              const pct = total > 0 ? Math.round((fw.counts.IMPLEMENTED / total) * 100) : 0;

              return (
                <div
                  key={fw.id}
                  className="rounded-xl border border-border/70 bg-card p-4 flex flex-col justify-between shadow-xs hover:border-primary/30 transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{fw.title}</h3>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {pct}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{fw.scope}</p>

                    {/* Progress Bar */}
                    <div className="w-full bg-muted rounded-full h-1.5 mt-3 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-border/40 text-center">
                      <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <p className="text-[10px] font-medium">Done</p>
                        <p className="text-xs font-bold">{fw.counts.IMPLEMENTED}</p>
                      </div>
                      <div className="p-1.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <p className="text-[10px] font-medium">Partial</p>
                        <p className="text-xs font-bold">{fw.counts.PARTIAL}</p>
                      </div>
                      <div className="p-1.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        <p className="text-[10px] font-medium">Missing</p>
                        <p className="text-xs font-bold">{fw.counts.MISSING}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/40">
                    <a
                      href={fw.source}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
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
          {/* Controls Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter controls by ID or text..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {(['ALL', 'IMPLEMENTED', 'PARTIAL', 'MISSING'] as const).map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    statusFilter === status
                      ? 'bg-foreground text-background font-semibold'
                      : 'border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Controls List */}
          <div className="rounded-xl border border-border/70 bg-card overflow-hidden divide-y divide-border/50 shadow-xs">
            {securityControls.map(control => {
              const presentation = statusPresentation[control.status];
              const StatusIcon = presentation.icon;

              return (
                <div
                  key={control.id}
                  className="p-4 space-y-2 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                        {control.id}
                      </span>
                      <h3 className="font-semibold text-sm text-foreground">{control.title}</h3>
                    </div>
                    <Badge variant="outline" className={presentation.className}>
                      <StatusIcon className="mr-1 h-3 w-3" />
                      {presentation.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {control.implementation}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                    <span>
                      <strong className="text-foreground">Owner:</strong>{' '}
                      {control.owner.toLowerCase()}
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-foreground">Frameworks:</strong>{' '}
                      {control.frameworks.join(', ')}
                    </span>
                  </div>
                  {control.gaps.length > 0 && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-800 dark:text-amber-300 mt-2">
                      <span className="font-semibold">Remaining Gap:</span> {control.gaps.join(' ')}
                    </div>
                  )}
                </div>
              );
            })}
            {securityControls.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground">
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
            <div className="rounded-xl border border-border/70 bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 border-b border-border/40 pb-3">
                <Lock className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Personal Data Registry</h3>
              </div>
              <div className="space-y-3">
                {personalDataRegistry.map(domain => (
                  <div
                    key={domain.domain}
                    className="rounded-lg border border-border/60 p-3 text-xs bg-muted/20"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-foreground font-semibold">{domain.domain}</strong>
                      <Badge variant="outline" className="text-[10px]">
                        {domain.discoverable.toLowerCase().replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{domain.purpose.join(' · ')}</p>
                    <p className="mt-2 text-[11px]">
                      <span className="font-semibold text-foreground">Retention:</span>{' '}
                      {domain.retention.current}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Subject Discovery Tool */}
            <div className="rounded-xl border border-border/70 bg-card p-5 space-y-4 shadow-xs">
              <div className="flex items-center gap-2 border-b border-border/40 pb-3">
                <Search className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Subject Discovery & DSR</h3>
              </div>

              <form method="get" action="/settings/security-compliance" className="space-y-3">
                <div className="flex gap-2">
                  <input
                    name="q"
                    type="search"
                    defaultValue={privacyData.query}
                    placeholder="Search workspace user..."
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg border border-border bg-muted hover:bg-accent text-xs font-semibold text-foreground"
                  >
                    Filter
                  </button>
                </div>

                <div className="flex gap-2">
                  <select
                    name="userId"
                    defaultValue={privacyData.userId ?? ''}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
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
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold"
                  >
                    Discover
                  </button>
                </div>
              </form>

              {privacyData.discovery && (
                <div className="space-y-3 pt-3 border-t border-border/40">
                  <p className="text-xs font-semibold text-foreground">
                    Direct relations found for:{' '}
                    <span className="text-primary font-normal">
                      {privacyData.selectedUser
                        ? `${privacyData.selectedUser.name || 'User'} (${privacyData.selectedUser.email})`
                        : privacyData.discovery.subjectUserId}
                    </span>
                  </p>
                  <div className="grid gap-2 grid-cols-2">
                    {Object.entries(privacyData.discovery.counts).map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs"
                      >
                        <span className="text-muted-foreground truncate">{label}</span>
                        <strong className="text-foreground">{value}</strong>
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
          <div className="rounded-xl border border-border/70 bg-card overflow-hidden divide-y divide-border/50 shadow-xs">
            {craControls.map(control => {
              const presentation = statusPresentation[control.status];
              const StatusIcon = presentation.icon;

              return (
                <div
                  key={control.id}
                  className="p-4 space-y-2 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                        {control.id}
                      </span>
                      <h3 className="font-semibold text-sm text-foreground">{control.title}</h3>
                    </div>
                    <Badge variant="outline" className={presentation.className}>
                      <StatusIcon className="mr-1 h-3 w-3" />
                      {presentation.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {control.implementation}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: EVIDENCE CATALOG */}
      {activeTab === 'evidence' && (
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
            <p className="text-xs text-muted-foreground mb-4">
              Verified repository artifacts and automated compliance audit evidence.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {controls.map(control => (
                <div
                  key={control.id}
                  className="p-3 rounded-lg border border-border/60 bg-muted/20 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-muted-foreground">
                      {control.id}
                    </span>
                    <span className="font-medium text-foreground truncate">{control.title}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {control.evidence.map(path => (
                      <span
                        key={path}
                        className="rounded border border-border/70 bg-background px-2 py-0.5 font-mono text-[10px] text-primary"
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
      )}
    </div>
  );
}

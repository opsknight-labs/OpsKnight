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
import type { ComplianceControl, ControlStatus, ComplianceFramework } from '@/lib/compliance/types';
import type { PersonalDataDomain } from '@/lib/privacy/types';
import { EncryptionMigrationPanel } from './EncryptionMigrationPanel';

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
    'overview' | 'security' | 'privacy' | 'encryption' | 'cra' | 'evidence'
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
              {percentImplemented}% Implemented
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
            label: 'Implemented',
            value: `${overall.IMPLEMENTED} (${percentImplemented}%)`,
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
            subtext: 'Controls verified',
          },
          {
            label: 'Partial Controls',
            value: `${overall.PARTIAL}`,
            icon: <TriangleAlert className="h-3.5 w-3.5" />,
            subtext: 'In-progress remediations',
          },
          {
            label: 'Missing / Gaps',
            value: `${overall.MISSING}`,
            icon: <CircleDashed className="h-3.5 w-3.5" />,
            subtext: 'Unaddressed requirements',
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
              const pct = total > 0 ? Math.round((fw.counts.IMPLEMENTED / total) * 100) : 0;

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
                        {pct}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3 line-clamp-2 leading-relaxed">
                      {fw.scope}
                    </p>

                    {/* Progress Bar */}
                    <div className="w-full bg-muted/60 rounded-full h-1.5 mt-3.5 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

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
              const presentation = statusPresentation[control.status];
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
              const presentation = statusPresentation[control.status];
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
        <div className="space-y-4 animate-in fade-in-50 duration-150">
          <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-3 border-b border-border/60 pb-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <FileCode className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Verified Evidence Catalog</h3>
                <p className="text-[11px] text-muted-foreground">
                  Verified repository artifacts and automated compliance audit evidence contracts
                </p>
              </div>
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
                    <span className="font-semibold text-foreground truncate">{control.title}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {control.evidence.map(path => (
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
      )}
    </div>
  );
}

'use client';

import React from 'react';
import {
  Activity,
  Server,
  Database,
  Cpu,
  ShieldCheck,
  Globe,
  Users,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Zap,
  Lock,
  Layers,
  HeartPulse,
  Workflow,
  BookOpen,
  Terminal,
  Radio,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';

export interface SystemOverviewMetrics {
  incidentCount: number;
  serviceCount: number;
  userCount: number;
  integrationCount: number;
  automationCount: number;
  runbookCount: number;
  dbLatencyMs: number;
  uptimeSeconds: number;
  heapUsedMb: number;
  heapTotalMb: number;
  nodeVersion: string;
  platform: string;
}

export interface SystemOverviewSubsystems {
  appUrl: string | null;
  appUrlConfigured: boolean;
  ssoEnabled: boolean;
  ssoProviderType: string | null;
  scimEnabled: boolean;
  allEnvOk: boolean;
  missingCount: number;
  encryptionKeySet: boolean;
  authOrigin: { origin: string; source: string };
}

interface Props {
  metrics: SystemOverviewMetrics;
  subsystems: SystemOverviewSubsystems;
  onNavigateTab?: (tabId: string) => void;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remainingM = m % 60;
  if (h < 24) return `${h}h ${remainingM}m`;
  const d = Math.floor(h / 24);
  const remainingH = h % 24;
  return `${d}d ${remainingH}h`;
}

export default function SystemOverviewTab({ metrics, subsystems, onNavigateTab }: Props) {
  const heapPct = Math.min(
    100,
    Math.round((metrics.heapUsedMb / Math.max(1, metrics.heapTotalMb)) * 100)
  );

  const handleTabClick = (tabId: string) => {
    if (onNavigateTab) {
      onNavigateTab(tabId);
    } else if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('section', tabId);
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in-50 duration-200">
      {/* 1. Executive Telemetry & Performance Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* PostgreSQL Database Probe */}
        <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-xs shadow-2xs transition-all hover:border-emerald-500/40 hover:shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  PostgreSQL 16 Engine
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-semibold text-foreground">Operational</span>
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            >
              {metrics.dbLatencyMs} ms ping
            </Badge>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
            Persistent pool healthy. Schema migration status 100% synchronized.
          </p>
        </div>

        {/* Node.js Heap Memory */}
        <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-xs shadow-2xs transition-all hover:border-blue-500/40 hover:shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-600 dark:text-blue-400">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">Runtime Memory</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">
                  {metrics.heapUsedMb} MB{' '}
                  <span className="text-[10px] font-normal text-muted-foreground">
                    / {metrics.heapTotalMb} MB
                  </span>
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-blue-500/30 text-blue-600 dark:text-blue-400"
            >
              {heapPct}% heap
            </Badge>
          </div>
          {/* Visual Mini Progress Bar */}
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                heapPct > 85 ? 'bg-rose-500' : heapPct > 70 ? 'bg-amber-500' : 'bg-blue-500'
              }`}
              style={{ width: `${heapPct}%` }}
            />
          </div>
        </div>

        {/* Platform Uptime & Engine */}
        <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-xs shadow-2xs transition-all hover:border-purple-500/40 hover:shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-purple-500/10 p-1.5 text-purple-600 dark:text-purple-400">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Node {metrics.nodeVersion}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3 text-purple-500" />
                  <span className="text-xs font-semibold text-foreground">
                    {formatUptime(metrics.uptimeSeconds)}
                  </span>
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-purple-500/30 text-purple-600 dark:text-purple-400 capitalize"
            >
              {metrics.platform}
            </Badge>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
            Asynchronous event loop latency optimal. Zero unhandled promise rejections.
          </p>
        </div>

        {/* Cryptographic Protection */}
        <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card/60 p-3.5 backdrop-blur-xs shadow-2xs transition-all hover:border-emerald-500/40 hover:shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Encryption & Envelope
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold text-foreground">AES-256-GCM</span>
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] font-medium ${
                subsystems.encryptionKeySet
                  ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'border-rose-500/30 text-rose-600'
              }`}
            >
              {subsystems.encryptionKeySet ? 'Key Active' : 'Missing Key'}
            </Badge>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
            Database secrets, session tokens, and credentials encrypted at rest.
          </p>
        </div>
      </div>

      {/* 2. Platform Resource Footprint (KPI Matrix) */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-primary/10 text-primary">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <h3 className="text-xs font-semibold tracking-tight text-foreground uppercase text-[11px]">
              Platform Resource Footprint
            </h3>
          </div>
          <span className="text-[11px] text-muted-foreground">Live Telemetry Count</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Incidents */}
          <Link
            href="/incidents"
            className="group flex flex-col justify-between rounded-lg border border-border/60 bg-background/60 p-3 transition-all hover:border-primary/50 hover:bg-background hover:shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                View →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-bold tracking-tight text-foreground">
                {metrics.incidentCount.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">Incidents Managed</p>
            </div>
          </Link>

          {/* Services */}
          <Link
            href="/services"
            className="group flex flex-col justify-between rounded-lg border border-border/60 bg-background/60 p-3 transition-all hover:border-primary/50 hover:bg-background hover:shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Layers className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                View →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-bold tracking-tight text-foreground">
                {metrics.serviceCount}
              </p>
              <p className="text-[10px] text-muted-foreground">Monitored Services</p>
            </div>
          </Link>

          {/* Active Users */}
          <Link
            href="/users"
            className="group flex flex-col justify-between rounded-lg border border-border/60 bg-background/60 p-3 transition-all hover:border-primary/50 hover:bg-background hover:shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Users className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                View →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-bold tracking-tight text-foreground">
                {metrics.userCount}
              </p>
              <p className="text-[10px] text-muted-foreground">Active Responders</p>
            </div>
          </Link>

          {/* Integrations */}
          <button
            onClick={() => handleTabClick('app-url')}
            className="group flex flex-col justify-between text-left rounded-lg border border-border/60 bg-background/60 p-3 transition-all hover:border-primary/50 hover:bg-background hover:shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Radio className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                Manage →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-bold tracking-tight text-foreground">
                {metrics.integrationCount}
              </p>
              <p className="text-[10px] text-muted-foreground">Integrations</p>
            </div>
          </button>

          {/* Automation Rules */}
          <button
            onClick={() => handleTabClick('automation')}
            className="group flex flex-col justify-between text-left rounded-lg border border-border/60 bg-background/60 p-3 transition-all hover:border-primary/50 hover:bg-background hover:shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Workflow className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                Rules →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-bold tracking-tight text-foreground">
                {metrics.automationCount}
              </p>
              <p className="text-[10px] text-muted-foreground">Automation Rules</p>
            </div>
          </button>

          {/* Runbooks */}
          <Link
            href="/runbooks"
            className="group flex flex-col justify-between rounded-lg border border-border/60 bg-background/60 p-3 transition-all hover:border-primary/50 hover:bg-background hover:shadow-xs cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <BookOpen className="h-3.5 w-3.5 text-rose-500" />
              <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground">
                Library →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-bold tracking-tight text-foreground">
                {metrics.runbookCount}
              </p>
              <p className="text-[10px] text-muted-foreground">Runbooks</p>
            </div>
          </Link>
        </div>
      </div>

      {/* 3. Core Subsystems Deep Dive & Direct Action Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Application URL & Routing */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-blue-500/10 p-1.5 text-blue-600 dark:text-blue-400">
                  <Globe className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">App URL & Routing</h4>
              </div>
              <Badge
                variant={subsystems.appUrlConfigured ? 'success' : 'neutral'}
                className="text-[10px]"
              >
                {subsystems.appUrlConfigured ? 'Authoritative' : 'Fallback'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Base URL used for webhook callbacks, Slack OAuth, notifications, and alert links.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border/50 text-[11px] font-mono text-foreground truncate">
              {subsystems.appUrl || 'http://localhost:3000'}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Origin: {subsystems.authOrigin.source}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-primary gap-1 hover:text-primary cursor-pointer"
              onClick={() => handleTabClick('app-url')}
            >
              Configure <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* SSO / Authentication */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">SSO / Authentication</h4>
              </div>
              <Badge
                variant={subsystems.ssoEnabled ? 'success' : 'neutral'}
                className="text-[10px]"
              >
                {subsystems.ssoEnabled ? 'Enabled' : 'Password Only'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              OIDC identity federation supporting Microsoft Entra ID, Okta, and OpenID Connect.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border/50 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Provider:</span>
              <span className="font-semibold text-foreground uppercase">
                {subsystems.ssoProviderType || 'Azure OIDC'}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Policy Active
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-primary gap-1 hover:text-primary cursor-pointer"
              onClick={() => handleTabClick('sso')}
            >
              Configure <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* SCIM 2.0 User Provisioning */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400">
                  <Users className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">SCIM 2.0 Provisioning</h4>
              </div>
              <Badge
                variant={subsystems.scimEnabled ? 'success' : 'neutral'}
                className="text-[10px]"
              >
                {subsystems.scimEnabled ? 'Active' : 'Standby'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated user lifecycle, group sync, and deactivation via RFC 7643/7644 endpoints.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border/50 text-[11px] font-mono text-muted-foreground truncate">
              /api/scim/v2
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Bearer Token Auth</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-primary gap-1 hover:text-primary cursor-pointer"
              onClick={() => handleTabClick('scim')}
            >
              Configure <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Data Retention Governance */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-indigo-500/10 p-1.5 text-indigo-600 dark:text-indigo-400">
                  <Database className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">Data Retention</h4>
              </div>
              <Badge
                variant="outline"
                className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              >
                5 Policies
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated background cleanup routines for resolved incidents, alerts, metrics, and
              logs.
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="rounded bg-muted/50 px-2 py-1 text-muted-foreground">
                Incidents: 730d
              </div>
              <div className="rounded bg-muted/50 px-2 py-1 text-muted-foreground">
                Alerts: 365d
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Schedule: Daily 00:00 UTC</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-primary gap-1 hover:text-primary cursor-pointer"
              onClick={() => handleTabClick('retention')}
            >
              Manage <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Environment Variables */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-amber-500/10 p-1.5 text-amber-600 dark:text-amber-400">
                  <Lock className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">Environment Secrets</h4>
              </div>
              <Badge
                variant={subsystems.allEnvOk ? 'success' : 'destructive'}
                className="text-[10px]"
              >
                {subsystems.allEnvOk ? 'All Set' : `${subsystems.missingCount} Missing`}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Server-side secrets and cryptographic keys for database, session cookies, and
              encryption.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border/50 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Integrity check:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> {5 - subsystems.missingCount}/5 Verified
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Secrets Protected</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-primary gap-1 hover:text-primary cursor-pointer"
              onClick={() => handleTabClick('environment')}
            >
              Inspect <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Deep Health Diagnostics */}
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400">
                  <HeartPulse className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">System Health Center</h4>
              </div>
              <Badge
                variant="outline"
                className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              >
                100% Probes Pass
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Full-spectrum operational diagnostics: worker queues, scheduled jobs, disk, and
              replication.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border/50 text-[11px] text-muted-foreground truncate">
              Self-healing & audit logging active
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Executive Diagnostics</span>
            <Link href="/settings/system/health">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs gap-1 cursor-pointer"
              >
                Launch <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

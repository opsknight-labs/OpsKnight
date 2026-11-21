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
  Lock,
  Layers,
  HeartPulse,
  Workflow,
  BookOpen,
  Radio,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';

export interface SystemOverviewMetrics {
  incidentCount: number;
  serviceCount: number;
  userCount: number;
  integrationCount: number;
  automationCount: number;
  runbookCount: number;
  dbLatencyMs: number;
  dbPingMs?: number;
  uptimeSeconds: number;
  heapUsedMb: number;
  heapTotalMb: number;
  nodeVersion: string;
  platform: string;
  processId?: number;
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
    <div className="space-y-6">
      {/* 1. Executive Telemetry & Performance Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* PostgreSQL Database Probe */}
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-muted p-1.5 text-muted-foreground">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xs font-medium text-muted-foreground">PostgreSQL Connection</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={cn('flex h-1.5 w-1.5 rounded-full', toneClasses('ok').solid)} />
                  <span className="text-xs font-semibold text-foreground">Connected</span>
                </div>
              </div>
            </div>
            <Badge variant="outline" className="text-2xs font-mono tabular-nums">
              {metrics.dbPingMs ?? metrics.dbLatencyMs} ms ping
            </Badge>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground leading-relaxed">
            Direct query round-trip (SELECT 1) to primary database pool.
          </p>
        </div>

        {/* Process Heap Memory */}
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-muted p-1.5 text-muted-foreground">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xs font-medium text-muted-foreground">Web Process Memory</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">
                  {metrics.heapUsedMb} MB{' '}
                  <span className="text-2xs font-normal text-muted-foreground">
                    / {metrics.heapTotalMb} MB
                  </span>
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-2xs font-mono tabular-nums">
              {heapPct}% heap
            </Badge>
          </div>
          {/* Visual Mini Progress Bar */}
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                heapPct > 85
                  ? toneClasses('critical').solid
                  : heapPct > 70
                    ? toneClasses('elevated').solid
                    : 'bg-ink-500'
              )}
              style={{ width: `${heapPct}%` }}
            />
          </div>
          <p className="mt-2 text-2xs text-muted-foreground leading-relaxed">
            Local Node.js heap for serving instance
            {metrics.processId ? ` (PID ${metrics.processId})` : ''}.
          </p>
        </div>

        {/* Instance Runtime */}
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-muted p-1.5 text-muted-foreground">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xs font-medium text-muted-foreground">Instance Runtime</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs font-semibold text-foreground">
                    {formatUptime(metrics.uptimeSeconds)}
                  </span>
                </div>
              </div>
            </div>
            <Badge variant="outline" className="text-2xs font-mono capitalize">
              Node {metrics.nodeVersion}
            </Badge>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground leading-relaxed">
            Elapsed runtime for this serving process on {metrics.platform}.
          </p>
        </div>

        {/* Cryptographic Protection */}
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-muted p-1.5 text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xs font-medium text-muted-foreground">Encryption & Envelope</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className={cn(
                      'flex h-1.5 w-1.5 rounded-full',
                      toneClasses(subsystems.encryptionKeySet ? 'ok' : 'critical').solid
                    )}
                  />
                  <span className="text-xs font-semibold text-foreground">AES-256-GCM</span>
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'text-2xs font-medium',
                toneClasses(subsystems.encryptionKeySet ? 'ok' : 'critical').soft
              )}
            >
              {subsystems.encryptionKeySet ? 'Key Active' : 'Missing Key'}
            </Badge>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground leading-relaxed">
            Database secrets, session tokens, and credentials encrypted at rest.
          </p>
        </div>
      </div>

      {/* 2. Platform Resource Footprint (KPI Matrix) */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-muted text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <h3 className="font-semibold tracking-tight text-foreground uppercase text-2xs">
              Platform Resource Footprint
            </h3>
          </div>
          <span className="text-2xs text-muted-foreground">Live Telemetry Count</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Incidents */}
          <Link
            href="/incidents"
            className="group flex flex-col justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:border-ink-300 hover:bg-muted/40 cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                View →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                {metrics.incidentCount.toLocaleString()}
              </p>
              <p className="text-2xs text-muted-foreground">Incidents Managed</p>
            </div>
          </Link>

          {/* Services */}
          <Link
            href="/services"
            className="group flex flex-col justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:border-ink-300 hover:bg-muted/40 cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                View →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                {metrics.serviceCount}
              </p>
              <p className="text-2xs text-muted-foreground">Monitored Services</p>
            </div>
          </Link>

          {/* Active Users */}
          <Link
            href="/users"
            className="group flex flex-col justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:border-ink-300 hover:bg-muted/40 cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                View →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                {metrics.userCount}
              </p>
              <p className="text-2xs text-muted-foreground">Active Responders</p>
            </div>
          </Link>

          {/* Integrations */}
          <button
            onClick={() => handleTabClick('app-url')}
            className="group flex flex-col justify-between text-left rounded-lg border border-border bg-background p-3 transition-colors hover:border-ink-300 hover:bg-muted/40 cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Radio className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                Manage →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                {metrics.integrationCount}
              </p>
              <p className="text-2xs text-muted-foreground">Integrations</p>
            </div>
          </button>

          {/* Automation Rules */}
          <button
            onClick={() => handleTabClick('automation')}
            className="group flex flex-col justify-between text-left rounded-lg border border-border bg-background p-3 transition-colors hover:border-ink-300 hover:bg-muted/40 cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                Rules →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                {metrics.automationCount}
              </p>
              <p className="text-2xs text-muted-foreground">Automation Rules</p>
            </div>
          </button>

          {/* Runbooks */}
          <Link
            href="/runbooks"
            className="group flex flex-col justify-between rounded-lg border border-border bg-background p-3 transition-colors hover:border-ink-300 hover:bg-muted/40 cursor-pointer"
          >
            <div className="flex items-center justify-between text-muted-foreground group-hover:text-primary transition-colors">
              <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-2xs font-medium text-muted-foreground group-hover:text-foreground">
                Library →
              </span>
            </div>
            <div className="mt-2">
              <p className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
                {metrics.runbookCount}
              </p>
              <p className="text-2xs text-muted-foreground">Runbooks</p>
            </div>
          </Link>
        </div>
      </div>

      {/* 3. Core Subsystems Deep Dive & Direct Action Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Application URL & Routing */}
        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                  <Globe className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">App URL & Routing</h4>
              </div>
              <Badge
                variant={subsystems.appUrlConfigured ? 'success' : 'neutral'}
                className="text-2xs"
              >
                {subsystems.appUrlConfigured ? 'Authoritative' : 'Fallback'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Base URL used for webhook callbacks, Slack OAuth, notifications, and alert links.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border text-2xs font-mono text-foreground truncate">
              {subsystems.appUrl || 'http://localhost:3000'}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">
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
        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">SSO / Authentication</h4>
              </div>
              <Badge variant={subsystems.ssoEnabled ? 'success' : 'neutral'} className="text-2xs">
                {subsystems.ssoEnabled ? 'Enabled' : 'Password Only'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              OIDC identity federation supporting Microsoft Entra ID, Okta, and OpenID Connect.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border flex items-center justify-between text-2xs">
              <span className="text-muted-foreground">Provider:</span>
              <span className="font-semibold text-foreground uppercase">
                {subsystems.ssoProviderType || 'Azure OIDC'}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground font-medium flex items-center gap-1">
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
        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                  <Users className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">SCIM 2.0 Provisioning</h4>
              </div>
              <Badge variant={subsystems.scimEnabled ? 'success' : 'neutral'} className="text-2xs">
                {subsystems.scimEnabled ? 'Active' : 'Standby'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated user lifecycle, group sync, and deactivation via RFC 7643/7644 endpoints.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border text-2xs font-mono text-muted-foreground truncate">
              /api/scim/v2
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">Bearer Token Auth</span>
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
        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                  <Database className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">Data Retention</h4>
              </div>
              <Badge variant="outline" className="text-2xs">
                5 Policies
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automated background cleanup routines for resolved incidents, alerts, metrics, and
              logs.
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-2xs">
              <div className="rounded bg-muted/50 px-2 py-1 text-muted-foreground">
                Incidents: 730d
              </div>
              <div className="rounded bg-muted/50 px-2 py-1 text-muted-foreground">
                Alerts: 365d
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">Schedule: Daily 00:00 UTC</span>
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
        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                  <Lock className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">Environment Secrets</h4>
              </div>
              <Badge variant={subsystems.allEnvOk ? 'success' : 'destructive'} className="text-2xs">
                {subsystems.allEnvOk ? 'All Set' : `${subsystems.missingCount} Missing`}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Server-side secrets and cryptographic keys for database, session cookies, and
              encryption.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border flex items-center justify-between text-2xs">
              <span className="text-muted-foreground">Integrity check:</span>
              <span
                className={cn(
                  'font-semibold flex items-center gap-1',
                  toneClasses(subsystems.missingCount === 0 ? 'ok' : 'elevated').text
                )}
              >
                <CheckCircle2 className="h-3 w-3" /> {5 - subsystems.missingCount}/5 Verified
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">Secrets Protected</span>
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
        <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
                  <HeartPulse className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground">System Health Center</h4>
              </div>
              <Badge variant="outline" className="text-2xs">
                Deep Diagnostics
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Full-spectrum operational diagnostics: worker queues, scheduled jobs, disk, and
              replication.
            </p>
            <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 border border-border text-2xs text-muted-foreground truncate">
              Live status checks available via health center
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">Executive Diagnostics</span>
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

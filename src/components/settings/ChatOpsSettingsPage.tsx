'use client';

import { useActionState, useState, useEffect, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveChatOpsConfig } from '@/app/(app)/settings/integrations/chatops/actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Switch } from '@/components/ui/shadcn/switch';
import { SlackLogo } from '@/components/common/BrandLogos';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  Video,
  Hash,
  Archive,
  AlertTriangle,
  Info,
  Check,
  Sparkles,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  Zap,
} from 'lucide-react';

type ChatOpsConfigView = {
  enabled: boolean;
  channelPrefix: string;
  autoCreateOnUrgency: string[];
  autoCreateOnPriority: string[];
  archiveOnResolve: boolean;
  defaultVideoBridge: string;
  customBridgeUrlTemplate: string | null;
  updatedAt: Date;
} | null;

const URGENCY_OPTIONS = [
  { value: 'HIGH', label: 'High', desc: 'Critical responder paging' },
  { value: 'MEDIUM', label: 'Medium', desc: 'Active team triage' },
  { value: 'LOW', label: 'Low', desc: 'Standard incident log' },
];

const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1', name: 'Critical', color: 'rose' },
  { value: 'P2', label: 'P2', name: 'High', color: 'orange' },
  { value: 'P3', label: 'P3', name: 'Moderate', color: 'amber' },
  { value: 'P4', label: 'P4', name: 'Low', color: 'blue' },
  { value: 'P5', label: 'P5', name: 'Info', color: 'slate' },
];

const VIDEO_BRIDGE_OPTIONS = [
  {
    value: 'JITSI',
    label: 'Jitsi Meet',
    badge: 'Instant 0-Setup',
    desc: 'Free, open-source instant room generated automatically per incident.',
  },
  {
    value: 'ZOOM',
    label: 'Zoom Meeting',
    badge: 'Enterprise',
    desc: 'Static war room link or vanity personal meeting ID.',
  },
  {
    value: 'GOOGLE_MEET',
    label: 'Google Meet',
    badge: 'Workspace',
    desc: 'Google Workspace room code or lookup URL template.',
  },
  {
    value: 'NONE',
    label: 'Disabled',
    badge: 'No Video',
    desc: 'Do not generate video bridge links for incidents.',
  },
];

const PROVIDER_HINTS: Record<string, { placeholder: string; hint: string; examples: string[] }> = {
  JITSI: {
    placeholder:
      'https://meet.jit.si/opsknight-inc-{incidentId} (Leave empty for default instant room)',
    hint: 'Generates an instant, 0-setup video war-room for every incident with no pre-created link needed.',
    examples: [
      'Default (Leave empty): https://meet.jit.si/opsknight-inc-XXXX',
      'Custom Jitsi Domain: https://jitsi.mycompany.com/warroom-{incidentId}',
    ],
  },
  ZOOM: {
    placeholder: 'https://us04web.zoom.us/j/1234567890 or https://myorg.zoom.us/my/warroom',
    hint: 'Zoom requires valid numeric meeting IDs (/j/1234567890) or personal vanity URLs (/my/warroom).',
    examples: [
      'Standard Zoom Link: https://us04web.zoom.us/j/1234567890',
      'Personal Room Link: https://myorg.zoom.us/my/incidentwarroom',
    ],
  },
  GOOGLE_MEET: {
    placeholder: 'https://meet.google.com/abc-defg-hij',
    hint: 'Google Meet requires a valid meeting room code or Google Workspace lookup link.',
    examples: [
      'Google Meet Call: https://meet.google.com/abc-defg-hij',
      'Workspace Lookup: https://meet.google.com/lookup/opsknight-inc-{incidentId}',
    ],
  },
  NONE: {
    placeholder: 'Video bridge disabled',
    hint: 'No video bridge link will be generated for incidents.',
    examples: [],
  },
};

function SubmitButton({ disabled, isDirty }: { disabled: boolean; isDirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={disabled || pending || !isDirty}
      size="sm"
      className="h-9 px-4 text-xs font-semibold gap-1.5 shadow-sm"
    >
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving Configuration...
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5" />
          Save Changes
        </>
      )}
    </Button>
  );
}

export default function ChatOpsSettingsPage({
  config,
  isAdmin,
  isSlackConnected,
}: {
  config: ChatOpsConfigView;
  isAdmin: boolean;
  isSlackConnected: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(saveChatOpsConfig, {
    error: null,
    success: false,
  });

  // Local state for interactive controls
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [channelPrefix, setChannelPrefix] = useState(config?.channelPrefix ?? 'inc');
  const [selectedUrgencies, setSelectedUrgencies] = useState<string[]>(
    config ? config.autoCreateOnUrgency : ['HIGH']
  );
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>(
    config ? config.autoCreateOnPriority : ['P1', 'P2']
  );
  const [archiveOnResolve, setArchiveOnResolve] = useState(config?.archiveOnResolve ?? true);
  const [selectedBridge, setSelectedBridge] = useState<string>(
    config?.defaultVideoBridge ?? 'JITSI'
  );
  const [customUrl, setCustomUrl] = useState<string>(config?.customBridgeUrlTemplate ?? '');

  const [prevUpdatedAt, setPrevUpdatedAt] = useState(config?.updatedAt);
  if (config?.updatedAt !== prevUpdatedAt) {
    setPrevUpdatedAt(config?.updatedAt);
    setEnabled(config?.enabled ?? false);
    setChannelPrefix(config?.channelPrefix || 'inc');
    setSelectedUrgencies(config?.autoCreateOnUrgency || ['HIGH']);
    setSelectedPriorities(config?.autoCreateOnPriority || ['P1', 'P2']);
    setArchiveOnResolve(config?.archiveOnResolve ?? true);
    setSelectedBridge(config?.defaultVideoBridge || 'JITSI');
    setCustomUrl(config?.customBridgeUrlTemplate || '');
  }

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  // Dirty state tracking
  const isDirty = useMemo(() => {
    if (!config) return Boolean(enabled || channelPrefix !== 'inc');
    const origUrgencies = config.autoCreateOnUrgency || [];
    const origPriorities = config.autoCreateOnPriority || [];
    const urgenciesMatch =
      selectedUrgencies.length === origUrgencies.length &&
      selectedUrgencies.every(u => origUrgencies.includes(u));
    const prioritiesMatch =
      selectedPriorities.length === origPriorities.length &&
      selectedPriorities.every(p => origPriorities.includes(p));

    return (
      enabled !== config.enabled ||
      channelPrefix !== config.channelPrefix ||
      !urgenciesMatch ||
      !prioritiesMatch ||
      archiveOnResolve !== config.archiveOnResolve ||
      selectedBridge !== config.defaultVideoBridge ||
      customUrl !== (config.customBridgeUrlTemplate || '')
    );
  }, [
    config,
    enabled,
    channelPrefix,
    selectedUrgencies,
    selectedPriorities,
    archiveOnResolve,
    selectedBridge,
    customUrl,
  ]);

  const activeHint =
    selectedBridge === 'ZOOM'
      ? PROVIDER_HINTS.ZOOM
      : selectedBridge === 'GOOGLE_MEET'
        ? PROVIDER_HINTS.GOOGLE_MEET
        : selectedBridge === 'NONE'
          ? PROVIDER_HINTS.NONE
          : PROVIDER_HINTS.JITSI;

  const toggleUrgency = (val: string) => {
    if (!isAdmin) return;
    setSelectedUrgencies(prev =>
      prev.includes(val) ? prev.filter(u => u !== val) : [...prev, val]
    );
  };

  const togglePriority = (val: string) => {
    if (!isAdmin) return;
    setSelectedPriorities(prev =>
      prev.includes(val) ? prev.filter(p => p !== val) : [...prev, val]
    );
  };

  const sanitizedPrefixDisplay =
    channelPrefix
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'inc';

  const insertVariable = (variable: string) => {
    setCustomUrl(prev => `${prev}${variable}`);
  };

  return (
    <form action={formAction} className="space-y-6">
      {/* ── Global Alerts (Error / Success) ── */}
      {state?.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-3 shadow-sm">
          <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">Configuration Error</p>
            <p>{state.error}</p>
          </div>
        </div>
      )}

      {state?.success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-3 shadow-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">Configuration Saved</p>
            <p>ChatOps channel rules and video war room settings updated successfully.</p>
          </div>
        </div>
      )}

      {/* ── Slack Integration Prerequisite Banner ── */}
      {!isSlackConnected ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-900 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold">Slack Integration Not Connected</p>
              <p className="text-rose-800 dark:text-rose-300">
                ChatOps requires an active Slack bot integration to create dedicated incident
                channels and post war room cards.
              </p>
            </div>
          </div>
          <Link
            href="/settings/integrations/slack"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs shrink-0 self-start sm:self-auto transition-colors shadow-sm"
          >
            <span>Connect Slack Integration</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold">Slack Bot Integration Connected</span>
            <span className="text-muted-foreground hidden sm:inline">•</span>
            <span className="text-muted-foreground hidden sm:inline">
              Bot has channel management and messaging scopes
            </span>
          </div>
          <Link
            href="/settings/integrations/slack"
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 self-start sm:self-auto"
          >
            <span>Manage Slack App</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* ── CARD 1: Slack Channel Automation & Naming ── */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#4A154B]/10 border border-[#4A154B]/20 text-[#4A154B] dark:text-[#E01E5A] shrink-0">
              <SlackLogo className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  Incident Channel Automation
                </h3>
                <Badge
                  variant={enabled ? 'success' : 'neutral'}
                  className="text-[10px] font-medium"
                >
                  {enabled ? 'Active' : 'Paused'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically provisions dedicated Slack incident channels when alerts trigger.
              </p>
            </div>
          </div>
        </div>

        {/* Master Toggle */}
        <div className="rounded-lg border bg-muted/20 p-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label
              htmlFor="chatops-enabled-switch"
              className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
            >
              <Zap className="h-3.5 w-3.5 text-primary" />
              Enable ChatOps Workflows
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Proactively creates Slack channels and invites incident responders upon incident
              creation.
            </p>
          </div>
          <Switch
            id="chatops-enabled-switch"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!isAdmin || !isSlackConnected}
          />
          <input type="hidden" name="enabled" value={enabled ? 'on' : 'off'} />
        </div>

        {/* Channel Prefix & Dynamic Simulator */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="channelPrefix"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
              >
                <Hash className="h-3.5 w-3.5" />
                Slack Channel Prefix
              </Label>
              <span className="text-[10px] text-muted-foreground">Max 20 chars</span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                #
              </span>
              <Input
                id="channelPrefix"
                name="channelPrefix"
                value={channelPrefix}
                onChange={e => setChannelPrefix(e.target.value)}
                placeholder="inc"
                className="pl-7 font-mono text-xs h-9 bg-background border-border/80"
                disabled={!isAdmin}
                required
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lowercase letters, numbers, and dashes only. e.g.{' '}
              <code className="bg-muted px-1 py-0.2 rounded font-mono">inc</code>,{' '}
              <code className="bg-muted px-1 py-0.2 rounded font-mono">incident</code>,{' '}
              <code className="bg-muted px-1 py-0.2 rounded font-mono">warroom</code>.
            </p>
          </div>

          {/* Dynamic Live Simulation Pill */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Live Channel Name Simulation
            </Label>
            <div className="rounded-lg border bg-muted/40 p-2.5 flex items-center gap-2">
              <span className="p-1 rounded bg-background border text-muted-foreground font-mono text-xs">
                #
              </span>
              <span className="font-mono text-xs font-semibold text-foreground truncate">
                {sanitizedPrefixDisplay}-402-database-latency
              </span>
              <Badge
                variant="outline"
                className="ml-auto text-[10px] border-border/60 bg-background text-muted-foreground"
              >
                Slack Channel
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Slack channels will be created matching this naming convention.
            </p>
          </div>
        </div>

        {/* Auto Archive Toggle */}
        <div className="rounded-lg border bg-muted/20 p-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label
              htmlFor="archive-switch"
              className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
            >
              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
              Auto-Archive Channel on Incident Resolution
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Automatically archives the Slack channel when the incident is resolved to keep
              workspace channels clean.
            </p>
          </div>
          <Switch
            id="archive-switch"
            checked={archiveOnResolve}
            onCheckedChange={setArchiveOnResolve}
            disabled={!isAdmin}
          />
          <input type="hidden" name="archiveOnResolve" value={archiveOnResolve ? 'on' : 'off'} />
        </div>
      </div>

      {/* ── CARD 2: Incident Auto-Creation Trigger Matrix ── */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Auto-Creation Triggers</h3>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Rule Matrix
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Channels and war rooms will be provisioned automatically when new incidents meet any
              selected condition.
            </p>
          </div>
        </div>

        {/* Hidden inputs to pass multi-select values to saveChatOpsConfig */}
        {selectedPriorities.map(p => (
          <input
            key={`hidden-p-${p}`}
            type="checkbox"
            name="autoCreateOnPriority"
            value={p}
            checked
            readOnly
            hidden
          />
        ))}
        {selectedUrgencies.map(u => (
          <input
            key={`hidden-u-${u}`}
            type="checkbox"
            name="autoCreateOnUrgency"
            value={u}
            checked
            readOnly
            hidden
          />
        ))}

        {/* Priority Triggers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Auto-Create on Incident Priority
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {selectedPriorities.length} of {PRIORITY_OPTIONS.length} active
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {PRIORITY_OPTIONS.map(option => {
              const active = selectedPriorities.includes(option.value);
              const colorClasses = {
                rose: active
                  ? 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/40'
                  : 'border-border/80 bg-background text-muted-foreground hover:border-border',
                orange: active
                  ? 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/40'
                  : 'border-border/80 bg-background text-muted-foreground hover:border-border',
                amber: active
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40'
                  : 'border-border/80 bg-background text-muted-foreground hover:border-border',
                blue: active
                  ? 'border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/40'
                  : 'border-border/80 bg-background text-muted-foreground hover:border-border',
                slate: active
                  ? 'border-slate-500/60 bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/40'
                  : 'border-border/80 bg-background text-muted-foreground hover:border-border',
              }[option.color];

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => togglePriority(option.value)}
                  disabled={!isAdmin}
                  className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${colorClasses}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">{option.label}</span>
                    {active && <Check className="h-3 w-3" />}
                  </div>
                  <span className="text-[11px] opacity-80">{option.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Urgency Triggers */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Auto-Create on Incident Urgency
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {selectedUrgencies.length} of {URGENCY_OPTIONS.length} active
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {URGENCY_OPTIONS.map(option => {
              const active = selectedUrgencies.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleUrgency(option.value)}
                  disabled={!isAdmin}
                  className={`p-3 rounded-lg border text-left flex flex-col gap-1 transition-all ${
                    active
                      ? 'border-primary/60 bg-primary/10 text-primary ring-1 ring-primary/40'
                      : 'border-border/80 bg-background text-muted-foreground hover:border-border'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{option.label} Urgency</span>
                    {active && <Check className="h-3 w-3" />}
                  </div>
                  <span className="text-[11px] opacity-80">{option.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── CARD 3: Video War Room Provider & URL Template ── */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Video War Room Bridge</h3>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Live Collaboration
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Generates an instant video bridge link posted inside Slack and the incident timeline.
            </p>
          </div>
        </div>

        {/* Hidden input for select bridge provider */}
        <input type="hidden" name="defaultVideoBridge" value={selectedBridge} />

        {/* Provider Cards Selector (2x2 Grid) */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Video className="h-3.5 w-3.5" />
            Video Bridge Provider
          </Label>
          <div className="grid sm:grid-cols-2 gap-3">
            {VIDEO_BRIDGE_OPTIONS.map(provider => {
              const active = selectedBridge === provider.value;
              return (
                <button
                  key={provider.value}
                  type="button"
                  onClick={() => isAdmin && setSelectedBridge(provider.value)}
                  disabled={!isAdmin}
                  className={`p-3.5 rounded-lg border text-left flex items-start gap-3 transition-all ${
                    active
                      ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/40 shadow-sm'
                      : 'border-border/80 bg-background hover:border-border'
                  }`}
                >
                  <div
                    className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                      active
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground/50 bg-background'
                    }`}
                  >
                    {active && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                      >
                        {provider.label}
                      </span>
                      <Badge variant="outline" className="text-[10px] border-border/80">
                        {provider.badge}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {provider.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom URL Template */}
        {selectedBridge !== 'NONE' && (
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="customBridgeUrlTemplate"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {selectedBridge === 'JITSI'
                  ? 'Custom Jitsi Domain / URL Template (Optional)'
                  : 'Meeting URL or Template'}
              </Label>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Insert:</span>
                <button
                  type="button"
                  onClick={() => insertVariable('{incidentId}')}
                  className="px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-[10px] font-mono text-primary transition-colors border"
                >
                  +{'{incidentId}'}
                </button>
              </div>
            </div>
            <Input
              id="customBridgeUrlTemplate"
              name="customBridgeUrlTemplate"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              placeholder={activeHint.placeholder}
              className="font-mono text-xs h-9 bg-background border-border/80"
              disabled={!isAdmin}
            />

            {/* Provider Guidance & Examples */}
            <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Info className="h-3.5 w-3.5 text-blue-500" />
                <span>Provider Guidance & Supported Formats</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{activeHint.hint}</p>
              {activeHint.examples.length > 0 && (
                <div className="pt-2 border-t space-y-1">
                  <span className="font-semibold text-[11px] text-muted-foreground">Examples:</span>
                  <ul className="space-y-1 text-[11px] text-muted-foreground font-mono">
                    {activeHint.examples.map((ex, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="text-muted-foreground/60">•</span>
                        <code className="bg-background px-1 py-0.5 rounded border border-border/60">
                          {ex}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── STICKY FLOATING ACTION BAR ── */}
      <div className="sticky bottom-4 z-10 bg-card/95 backdrop-blur-md shadow-lg border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {isDirty && (
            <Badge
              variant="outline"
              className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10"
            >
              Unsaved Changes
            </Badge>
          )}
          <span>
            {config
              ? `Last modified on ${new Date(config.updatedAt).toLocaleDateString()}`
              : 'Configure ChatOps rules to automate incident collaboration.'}
          </span>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <SubmitButton disabled={!isAdmin} isDirty={isDirty} />
        </div>
      </div>
    </form>
  );
}

'use client';

import { useActionState, useState, useEffect, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { saveChatOpsConfig } from '@/app/(app)/settings/integrations/chatops/actions';
import type { SettingsActionState } from '@/lib/settings-result';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  Video,
  Archive,
  AlertTriangle,
  Check,
  Zap,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import type { WarRoomProviderSet } from '@/lib/incident-collaboration/types';
import { WarRoomProviderStatus, type ProviderStatusProps } from './chatops/WarRoomProviderStatus';
import { WarRoomProviderCapabilities } from './chatops/WarRoomProviderCapabilities';

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
    value: 'MICROSOFT_TEAMS',
    label: 'Microsoft Teams Meeting',
    badge: 'Native Graph Bridge',
    desc: 'Instant Microsoft Graph online meeting created per incident.',
  },
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
  MICROSOFT_TEAMS: {
    placeholder: 'Auto-generated via Microsoft Graph (Leave empty for instant online meeting)',
    hint: 'Generates a native Microsoft Teams online meeting bridge with dial-in audio conferencing via Microsoft Graph.',
    examples: [
      'Default (Leave empty): Native Microsoft Graph Online Meeting created per incident',
      'Static Link: https://teams.microsoft.com/l/meetup-join/...',
    ],
  },
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
  providerStatus,
  defaultProviders = ['SLACK', 'MICROSOFT_TEAMS'],
}: {
  config: ChatOpsConfigView;
  isAdmin: boolean;
  providerStatus: ProviderStatusProps;
  defaultProviders?: WarRoomProviderSet;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<SettingsActionState, FormData>(saveChatOpsConfig, {
    error: null,
    success: false,
    updatedAt: config?.updatedAt ? new Date(config.updatedAt).toISOString() : null,
  });

  const initialDefaultOption: 'SLACK' | 'MICROSOFT_TEAMS' | 'BOTH' = useMemo(() => {
    if (defaultProviders.includes('SLACK') && defaultProviders.includes('MICROSOFT_TEAMS')) {
      return 'BOTH';
    }
    if (defaultProviders.includes('SLACK')) {
      return 'SLACK';
    }
    if (defaultProviders.includes('MICROSOFT_TEAMS')) {
      return 'MICROSOFT_TEAMS';
    }
    return 'BOTH';
  }, [defaultProviders]);

  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [channelPrefix, setChannelPrefix] = useState(config?.channelPrefix ?? 'inc');
  const [selectedDefaultOption, setSelectedDefaultOption] = useState<
    'SLACK' | 'MICROSOFT_TEAMS' | 'BOTH'
  >(initialDefaultOption);
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
    setSelectedDefaultOption(initialDefaultOption);
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
      selectedDefaultOption !== initialDefaultOption ||
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
    selectedDefaultOption,
    initialDefaultOption,
    selectedUrgencies,
    selectedPriorities,
    archiveOnResolve,
    selectedBridge,
    customUrl,
  ]);

  const activeHint =
    selectedBridge === 'MICROSOFT_TEAMS'
      ? PROVIDER_HINTS.MICROSOFT_TEAMS
      : selectedBridge === 'ZOOM'
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
      {state?.code === 'SETTINGS_CHANGED' && (
        <div
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-100 flex flex-col sm:flex-row sm:items-start justify-between gap-3 shadow-sm"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <p className="font-semibold">Settings changed elsewhere</p>
              <p>{state.error}</p>
              <p className="opacity-80">
                Your unsaved ChatOps edits are preserved. Reload before saving again.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-1.5 shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload latest
          </Button>
        </div>
      )}

      {state?.error && state.code !== 'SETTINGS_CHANGED' && (
        <div
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-3 shadow-sm"
          role="alert"
        >
          <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">Configuration Error</p>
            <p>{state.error}</p>
          </div>
        </div>
      )}

      {state?.success && (
        <div
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-3 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">Configuration Saved</p>
            <p>War room collaboration policies and video bridge settings updated successfully.</p>
          </div>
        </div>
      )}

      {/* Dynamic Connected Providers Section */}
      <WarRoomProviderStatus slack={providerStatus.slack} teams={providerStatus.teams} />

      {/* Global War Room Policy Section */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 text-primary shrink-0">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  War Room & Collaboration Policy
                </h3>
                <Badge
                  variant={enabled ? 'default' : 'secondary'}
                  className="text-[10px] font-medium"
                >
                  {enabled ? 'Active' : 'Paused'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controls global creation permissions, automated room triggers, and naming
                conventions.
              </p>
            </div>
          </div>
        </div>

        {/* Global Enablement Switch */}
        <div className="rounded-lg border bg-muted/20 p-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label
              htmlFor="chatops-enabled-switch"
              className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
            >
              <Zap className="h-3.5 w-3.5 text-primary" />
              Enable War Room Provisioning
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Allows OpsKnight to provision incident collaboration rooms and sync responders across
              connected providers.
            </p>
          </div>
          <Switch
            id="chatops-enabled-switch"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!isAdmin}
          />
          <input type="hidden" name="enabled" value={enabled ? 'on' : 'off'} />
        </div>

        {/* Default War Room Provider Policy */}
        <div className="space-y-3 pt-4 border-t">
          <div className="space-y-0.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
              Default War Room Provider
            </Label>
            <p className="text-xs text-muted-foreground">
              Used by services that do not define their own service-level provider override.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {/* Slack Option */}
            <label
              className={`flex flex-col justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                selectedDefaultOption === 'SLACK'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/30'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SlackLogo className="h-4 w-4" />
                    <span className="text-xs font-bold text-foreground">Slack</span>
                  </div>
                  {providerStatus.slack.connected ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0 font-normal border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                    >
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0 font-normal border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                    >
                      Unavailable
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Provision dedicated incident channels in Slack by default.
                </p>
              </div>
              <input
                type="radio"
                name="defaultProviders"
                value="SLACK"
                checked={selectedDefaultOption === 'SLACK'}
                onChange={() => setSelectedDefaultOption('SLACK')}
                disabled={!isAdmin}
                className="sr-only"
              />
            </label>

            {/* Microsoft Teams Option */}
            <label
              className={`flex flex-col justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                selectedDefaultOption === 'MICROSOFT_TEAMS'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/30'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MicrosoftTeamsLogo className="h-4 w-4" />
                    <span className="text-xs font-bold text-foreground">Microsoft Teams</span>
                  </div>
                  {providerStatus.teams.connected ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0 font-normal border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                    >
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1.5 py-0 font-normal border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                    >
                      Unavailable
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Provision dedicated incident channels in Microsoft Teams by default.
                </p>
              </div>
              <input
                type="radio"
                name="defaultProviders"
                value="MICROSOFT_TEAMS"
                checked={selectedDefaultOption === 'MICROSOFT_TEAMS'}
                onChange={() => setSelectedDefaultOption('MICROSOFT_TEAMS')}
                disabled={!isAdmin}
                className="sr-only"
              />
            </label>

            {/* Both Option */}
            <label
              className={`flex flex-col justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                selectedDefaultOption === 'BOTH'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:bg-muted/30'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <SlackLogo className="h-3.5 w-3.5" />
                    <span className="text-muted-foreground text-xs">+</span>
                    <MicrosoftTeamsLogo className="h-3.5 w-3.5" />
                    <span className="text-xs font-bold text-foreground ml-1">Both</span>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 font-normal border-primary/40 text-primary"
                  >
                    Multi-platform
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Simultaneously provision incident war rooms across both Slack and Teams.
                </p>
              </div>
              <input
                type="radio"
                name="defaultProviders"
                value="BOTH"
                checked={selectedDefaultOption === 'BOTH'}
                onChange={() => setSelectedDefaultOption('BOTH')}
                disabled={!isAdmin}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {/* Room Naming Policy */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="channelPrefix"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Room Name Prefix
              </Label>
              <span className="text-[10px] text-muted-foreground">Max 20 chars</span>
            </div>
            <Input
              id="channelPrefix"
              name="channelPrefix"
              value={channelPrefix}
              onChange={e => setChannelPrefix(e.target.value)}
              disabled={!isAdmin}
              placeholder="inc"
              className="font-mono text-sm h-10"
              maxLength={20}
            />
            <p className="text-[11px] text-muted-foreground">
              Prefix applied when naming incident collaboration channels.
            </p>
          </div>

          <div className="rounded-lg border border-border/80 bg-muted/30 p-3.5 space-y-2">
            <span className="text-xs font-semibold text-foreground block">
              Generated Name Preview
            </span>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between py-1 border-b border-border/40">
                <span className="text-muted-foreground font-sans">Slack:</span>
                <span className="text-primary font-semibold">
                  #{sanitizedPrefixDisplay}-payments-api-a82c
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground font-sans">Teams:</span>
                <span className="text-primary font-semibold">
                  {sanitizedPrefixDisplay}-payments-api-a82c
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Automatic Creation Policy */}
        <div className="space-y-4 pt-4 border-t">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Automatic Creation Rules
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              OpsKnight will automatically request a collaboration war room when an incident meets
              either threshold.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Priority Triggers */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground block">
                Trigger on Priority
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITY_OPTIONS.map(opt => {
                  const isSelected = selectedPriorities.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => togglePriority(opt.value)}
                      disabled={!isAdmin}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/80'
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span className="text-[10px] font-normal opacity-80">{opt.name}</span>
                    </button>
                  );
                })}
              </div>
              {selectedPriorities.map(p => (
                <input key={p} type="hidden" name="autoCreateOnPriority" value={p} />
              ))}
            </div>

            {/* Urgency Triggers */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground block">
                Trigger on Urgency
              </span>
              <div className="flex flex-wrap gap-1.5">
                {URGENCY_OPTIONS.map(opt => {
                  const isSelected = selectedUrgencies.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleUrgency(opt.value)}
                      disabled={!isAdmin}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/80'
                      }`}
                    >
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              {selectedUrgencies.map(u => (
                <input key={u} type="hidden" name="autoCreateOnUrgency" value={u} />
              ))}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Active policy: </span>
            {selectedPriorities.length > 0 || selectedUrgencies.length > 0 ? (
              <span>
                War rooms will be automatically requested for incidents with{' '}
                {selectedPriorities.length > 0 && `priority ${selectedPriorities.join(', ')}`}
                {selectedPriorities.length > 0 && selectedUrgencies.length > 0 && ' or '}
                {selectedUrgencies.length > 0 && `urgency ${selectedUrgencies.join(', ')}`}.
              </span>
            ) : (
              <span>No automatic triggers set. War rooms are created manually by operators.</span>
            )}
          </div>
        </div>

        {/* War Room Lifecycle Setting */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label
                htmlFor="archiveOnResolve"
                className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
              >
                <Archive className="h-3.5 w-3.5 text-primary" />
                Close Collaboration on Resolution
              </Label>
              <p className="text-[11px] text-muted-foreground">
                When an incident is resolved, automatically initiate channel closing and archival
                where supported.
              </p>
            </div>
            <Switch
              id="archiveOnResolve"
              checked={archiveOnResolve}
              onCheckedChange={setArchiveOnResolve}
              disabled={!isAdmin}
            />
            <input type="hidden" name="archiveOnResolve" value={archiveOnResolve ? 'on' : 'off'} />
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-[11px] text-muted-foreground bg-muted/20 p-3 rounded-lg border">
            <div>
              <span className="font-semibold text-foreground block">Slack</span>
              <span>Channel is automatically archived if bot permissions allow.</span>
            </div>
            <div>
              <span className="font-semibold text-foreground block">Microsoft Teams</span>
              <span>OpsKnight marks war room closed; channel follows provider retention.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Video Collaboration Section */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 text-primary shrink-0">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Video War Room Bridge</h3>
              <p className="text-xs text-muted-foreground">
                Configure instant video conference bridges linked in ChatOps cards and incident
                headers.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {VIDEO_BRIDGE_OPTIONS.map(opt => {
            const isSelected = selectedBridge === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex flex-col justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card hover:bg-muted/30'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">{opt.label}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">
                      {opt.badge}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.desc}</p>
                </div>
                <input
                  type="radio"
                  name="defaultVideoBridge"
                  value={opt.value}
                  checked={isSelected}
                  onChange={() => setSelectedBridge(opt.value)}
                  disabled={!isAdmin}
                  className="sr-only"
                />
              </label>
            );
          })}
        </div>

        {selectedBridge !== 'NONE' && (
          <div className="space-y-2 pt-2">
            <Label
              htmlFor="customBridgeUrlTemplate"
              className="text-xs font-semibold text-foreground"
            >
              Bridge URL Template (Optional)
            </Label>
            <Input
              id="customBridgeUrlTemplate"
              name="customBridgeUrlTemplate"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              disabled={!isAdmin}
              placeholder={activeHint.placeholder}
              className="text-xs font-mono h-9"
            />
            <p className="text-[11px] text-muted-foreground">{activeHint.hint}</p>
            {activeHint.examples.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-muted-foreground">Insert variable:</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] font-mono px-2"
                  onClick={() => insertVariable('{incidentId}')}
                  disabled={!isAdmin}
                >
                  +{'{incidentId}'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Provider Capabilities Reference */}
      <WarRoomProviderCapabilities />

      {/* Form Submission Footer */}
      {isAdmin && (
        <div className="flex items-center justify-between p-4 rounded-xl border bg-card shadow-xs">
          <span className="text-xs text-muted-foreground">
            {isDirty ? 'You have unsaved changes' : 'All settings saved'}
          </span>
          <SubmitButton disabled={!isAdmin} isDirty={isDirty} />
        </div>
      )}
    </form>
  );
}

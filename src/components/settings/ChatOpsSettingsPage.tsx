'use client';

import { useActionState, useState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { saveChatOpsConfig } from '@/app/(app)/settings/integrations/chatops/actions';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  MessageCircle,
  Video,
  Hash,
  Archive,
  AlertTriangle,
  Info,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  {
    value: 'HIGH',
    label: 'High Urgency',
    color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
  },
  {
    value: 'MEDIUM',
    label: 'Medium Urgency',
    color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  },
  {
    value: 'LOW',
    label: 'Low Urgency',
    color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  },
];

const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1 - Blocker', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  { value: 'P2', label: 'P2 - Critical', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'P3', label: 'P3 - Major', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  {
    value: 'P4',
    label: 'P4 - Moderate',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  { value: 'P5', label: 'P5 - Minor', color: 'bg-slate-50 text-slate-700 border-slate-200' },
];

const VIDEO_BRIDGE_OPTIONS = [
  { value: 'JITSI', label: 'Jitsi Meet (Instant Zero-Setup War-Room)' },
  { value: 'ZOOM', label: 'Zoom (Enterprise Meeting Link)' },
  { value: 'GOOGLE_MEET', label: 'Google Meet (Workspace Meeting Link)' },
  { value: 'NONE', label: 'Disabled (No video link generated)' },
];

const PROVIDER_HINTS: Record<string, { placeholder: string; hint: string; examples: string[] }> = {
  JITSI: {
    placeholder:
      'https://meet.jit.si/opsknight-inc-{incidentId} (Leave empty for default instant room)',
    hint: 'Generates an instant, zero-setup video war room for every incident with no pre-created link needed.',
    examples: [
      'Default (Leave empty): https://meet.jit.si/opsknight-inc-1042',
      'Custom Jitsi Domain: https://jitsi.mycompany.com/warroom-1042',
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

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Save ChatOps Configuration
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

  const [enabled, setEnabled] = useState<boolean>(config?.enabled ?? false);
  const [channelPrefix, setChannelPrefix] = useState<string>(config?.channelPrefix ?? 'inc');
  const [selectedUrgencies, setSelectedUrgencies] = useState<string[]>(
    config ? config.autoCreateOnUrgency : ['HIGH']
  );
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>(
    config ? config.autoCreateOnPriority : ['P1', 'P2']
  );
  const [archiveOnResolve, setArchiveOnResolve] = useState<boolean>(
    config?.archiveOnResolve ?? true
  );
  const [selectedBridge, setSelectedBridge] = useState<string>(
    config?.defaultVideoBridge ?? 'JITSI'
  );
  const [customUrl, setCustomUrl] = useState<string>(config?.customBridgeUrlTemplate ?? '');

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled ?? false);
      setChannelPrefix(config.channelPrefix ?? 'inc');
      setSelectedUrgencies(config.autoCreateOnUrgency ?? ['HIGH']);
      setSelectedPriorities(config.autoCreateOnPriority ?? ['P1', 'P2']);
      setArchiveOnResolve(config.archiveOnResolve ?? true);
      setSelectedBridge(config.defaultVideoBridge || 'JITSI');
      setCustomUrl(config.customBridgeUrlTemplate || '');
    }
  }, [config]);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  const toggleUrgency = (val: string) => {
    setSelectedUrgencies(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  const togglePriority = (val: string) => {
    setSelectedPriorities(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  const activeHint = PROVIDER_HINTS[selectedBridge] || PROVIDER_HINTS.JITSI;
  const safePrefix =
    channelPrefix
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '') || 'inc';

  return (
    <div className="space-y-6">
      <SettingsSection
        title="ChatOps & Incident War-Rooms"
        description="Automatically provision dedicated Slack channels and video conference bridges when major incidents occur."
        action={
          <Badge variant={enabled ? 'default' : 'secondary'}>
            {enabled ? 'Active' : 'Disabled'}
          </Badge>
        }
      >
        <form action={formAction} className="space-y-6 py-6">
          {/* Hidden inputs to guarantee FormData serialization */}
          <input type="hidden" name="enabled" value={enabled ? 'on' : 'off'} />
          <input type="hidden" name="archiveOnResolve" value={archiveOnResolve ? 'on' : 'off'} />
          {selectedUrgencies.map(u => (
            <input key={u} type="hidden" name="autoCreateOnUrgency" value={u} />
          ))}
          {selectedPriorities.map(p => (
            <input key={p} type="hidden" name="autoCreateOnPriority" value={p} />
          ))}

          {!isSlackConnected && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Slack workspace is not connected. ChatOps channel provisioning requires an active
                Slack bot integration.
              </AlertDescription>
            </Alert>
          )}

          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          {state?.success && (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription>ChatOps configuration saved successfully.</AlertDescription>
            </Alert>
          )}

          {/* 1. Global Enable Switch */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200/80 bg-muted/20 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <Label htmlFor="chatops-enabled" className="text-base font-semibold">
                  Enable Automated ChatOps
                </Label>
                <p className="text-xs text-muted-foreground">
                  Create isolated incident response channels and post situational updates in Slack.
                </p>
              </div>
            </div>
            <Switch
              id="chatops-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!isAdmin}
            />
          </div>

          {/* 2. Channel Naming & Live Preview */}
          <div className="space-y-4 rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs">
            <div className="space-y-1">
              <Label
                htmlFor="channelPrefix"
                className="text-sm font-semibold flex items-center gap-1.5"
              >
                <Hash className="h-4 w-4 text-primary" />
                Slack Channel Naming Format
              </Label>
              <p className="text-xs text-muted-foreground">
                Customize the prefix used when auto-provisioning channels for responders.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 items-center">
              <div>
                <Input
                  id="channelPrefix"
                  name="channelPrefix"
                  value={channelPrefix}
                  onChange={e => setChannelPrefix(e.target.value)}
                  placeholder="inc"
                  disabled={!isAdmin}
                  required
                  className="h-10"
                />
              </div>

              {/* Live Preview Pill */}
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Live Channel Name Preview
                </span>
                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-foreground">
                  <span className="text-primary">#</span>
                  <span>{safePrefix}-1042-payment-gateway-timeout</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Trigger Conditions (Urgency & Priority Chips) */}
          <div className="space-y-5 rounded-xl border border-slate-200/80 bg-background p-4 shadow-2xs">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Auto-Create Channels on Incident Urgency
              </Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {URGENCY_OPTIONS.map(opt => {
                  const isSelected = selectedUrgencies.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleUrgency(opt.value)}
                      disabled={!isAdmin}
                      className={cn(
                        'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-150',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-background text-muted-foreground border-slate-200 hover:bg-slate-50 hover:text-foreground'
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-100">
              <Label className="text-sm font-semibold">
                Auto-Create Channels on Incident Priority
              </Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {PRIORITY_OPTIONS.map(opt => {
                  const isSelected = selectedPriorities.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => togglePriority(opt.value)}
                      disabled={!isAdmin}
                      className={cn(
                        'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-150',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-background text-muted-foreground border-slate-200 hover:bg-slate-50 hover:text-foreground'
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. Video Bridge Integration */}
          <div className="space-y-4 rounded-xl border border-slate-200/80 bg-muted/10 p-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Video className="h-4 w-4 text-primary" /> Video Conference Bridge
              </Label>
              <Badge variant="outline" className="text-xs font-semibold">
                {selectedBridge}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="defaultVideoBridge" className="text-xs font-medium">
                  Default Video Bridge Provider
                </Label>
                <select
                  id="defaultVideoBridge"
                  name="defaultVideoBridge"
                  value={selectedBridge}
                  onChange={e => setSelectedBridge(e.target.value)}
                  disabled={!isAdmin}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-slate-200 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {VIDEO_BRIDGE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="customBridgeUrlTemplate" className="text-xs font-medium">
                  {selectedBridge === 'JITSI'
                    ? 'Custom Jitsi Domain (Optional)'
                    : 'Meeting URL / Template'}
                </Label>
                <Input
                  id="customBridgeUrlTemplate"
                  name="customBridgeUrlTemplate"
                  value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)}
                  placeholder={activeHint.placeholder}
                  disabled={!isAdmin || selectedBridge === 'NONE'}
                  className="h-10"
                />
              </div>
            </div>

            {/* Provider Guidance Callout */}
            <div className="rounded-lg border border-slate-200 bg-background p-3 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Info className="h-3.5 w-3.5 text-primary" />
                <span>Video Bridge Details</span>
              </div>
              <p className="text-muted-foreground">{activeHint.hint}</p>
              {activeHint.examples.length > 0 && (
                <div className="pt-1.5 border-t border-slate-100 space-y-1">
                  <span className="font-semibold text-muted-foreground text-[11px]">
                    Supported URL Formats:
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-muted-foreground font-mono">
                    {activeHint.examples.map((ex, i) => (
                      <li key={i}>{ex}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* 5. Archive on Resolution */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200/80 bg-background shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
                <Archive className="h-4 w-4" />
              </div>
              <div>
                <Label htmlFor="archive-resolve" className="text-sm font-semibold">
                  Archive Slack Channel on Incident Resolution
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically clean up temporary response channels once the incident is marked
                  RESOLVED.
                </p>
              </div>
            </div>
            <Switch
              id="archive-resolve"
              checked={archiveOnResolve}
              onCheckedChange={setArchiveOnResolve}
              disabled={!isAdmin}
            />
          </div>

          {/* Footer Save Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <div className="text-xs text-muted-foreground">
              {config
                ? `Last updated on ${new Date(config.updatedAt).toLocaleDateString()}`
                : 'No ChatOps configuration yet.'}
            </div>
            <SubmitButton disabled={!isAdmin} />
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}

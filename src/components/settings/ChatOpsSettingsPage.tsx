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
import { CheckCircle2, Loader2, XCircle, MessageCircle, Video, Hash, Archive, AlertTriangle, Info } from 'lucide-react';

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
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
  { value: 'P4', label: 'P4' },
  { value: 'P5', label: 'P5' },
];

const VIDEO_BRIDGE_OPTIONS = [
  { value: 'JITSI', label: 'Jitsi Meet (Instant War-Room)' },
  { value: 'ZOOM', label: 'Zoom (Enterprise Link)' },
  { value: 'GOOGLE_MEET', label: 'Google Meet (Enterprise Link)' },
  { value: 'NONE', label: 'None (Disabled)' },
];

const PROVIDER_HINTS: Record<string, { placeholder: string; hint: string; examples: string[] }> = {
  JITSI: {
    placeholder: 'https://meet.jit.si/opsknight-inc-{incidentId} (Leave empty for default instant room)',
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

  const [selectedBridge, setSelectedBridge] = useState<string>(config?.defaultVideoBridge ?? 'JITSI');
  const [customUrl, setCustomUrl] = useState<string>(config?.customBridgeUrlTemplate ?? '');

  // Keep controlled state in sync with props and server updates
  useEffect(() => {
    if (config) {
      setSelectedBridge(config.defaultVideoBridge || 'JITSI');
      setCustomUrl(config.customBridgeUrlTemplate || '');
    }
  }, [config]);

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  const activeHint = PROVIDER_HINTS[selectedBridge] || PROVIDER_HINTS.JITSI;
  const selectedUrgencies = config ? config.autoCreateOnUrgency : ['HIGH'];
  const selectedPriorities = config ? config.autoCreateOnPriority : ['P1', 'P2'];

  return (
    <div className="space-y-6">
      <SettingsSection
        title="ChatOps Settings"
        description="Configure automatic Slack channels and video war rooms for incidents."
        action={
          <Badge variant={config?.enabled ? 'default' : 'secondary'}>
            {config?.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        }
      >
        <form action={formAction} className="space-y-6 py-6">
          {!isSlackConnected && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Slack is not connected. ChatOps requires an active Slack integration to create channels.
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

          <div className="space-y-4">
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={config?.enabled ?? false}
                disabled={!isAdmin}
                className="h-4 w-4"
              />
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              Enable ChatOps workflows
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="channelPrefix" className="flex items-center gap-2">
                  <Hash className="h-4 w-4" /> Channel Prefix
                </Label>
                <Input
                  id="channelPrefix"
                  name="channelPrefix"
                  defaultValue={config?.channelPrefix ?? 'inc'}
                  placeholder="inc"
                  disabled={!isAdmin}
                  required
                />
              </div>
            </div>
          </div>

          <div className="rounded-md border p-4 space-y-4">
            <Label className="text-sm font-medium">Auto-create channels on Incident Urgency</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {URGENCY_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="autoCreateOnUrgency"
                    value={option.value}
                    defaultChecked={selectedUrgencies.includes(option.value)}
                    disabled={!isAdmin}
                    className="h-4 w-4"
                  />
                  {option.label}
                </label>
              ))}
            </div>

            <Label className="text-sm font-medium mt-4 block">Auto-create channels on Incident Priority</Label>
            <div className="grid gap-2 sm:grid-cols-5">
              {PRIORITY_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="autoCreateOnPriority"
                    value={option.value}
                    defaultChecked={selectedPriorities.includes(option.value)}
                    disabled={!isAdmin}
                    className="h-4 w-4"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          {/* Video War Room Configuration Section */}
          <div className="space-y-4 rounded-md border p-4 bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Video className="h-4 w-4 text-primary" /> Video War Room Integration
              </Label>
              <Badge variant="outline" className="text-xs">
                {selectedBridge}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultVideoBridge">Default Video Bridge Provider</Label>
                <select
                  id="defaultVideoBridge"
                  name="defaultVideoBridge"
                  value={selectedBridge}
                  onChange={(e) => setSelectedBridge(e.target.value)}
                  disabled={!isAdmin}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {VIDEO_BRIDGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="customBridgeUrlTemplate">
                  {selectedBridge === 'JITSI' ? 'Custom Jitsi Domain (Optional)' : 'Meeting URL / Template'}
                </Label>
                <Input
                  id="customBridgeUrlTemplate"
                  name="customBridgeUrlTemplate"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder={activeHint.placeholder}
                  disabled={!isAdmin || selectedBridge === 'NONE'}
                />
              </div>
            </div>

            <div className="rounded-md border bg-background p-3 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Info className="h-3.5 w-3.5 text-blue-500" />
                <span>Provider Guidance & Supported URL Formats</span>
              </div>
              <p className="text-muted-foreground">{activeHint.hint}</p>
              {activeHint.examples.length > 0 && (
                <div className="pt-1.5 border-t space-y-1">
                  <span className="font-semibold text-muted-foreground">Supported URL Examples:</span>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-muted-foreground">
                    {activeHint.examples.map((ex, i) => (
                      <li key={i}><code className="bg-muted px-1 py-0.5 rounded">{ex}</code></li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedBridge !== 'NONE' && (
                <p className="text-muted-foreground text-[11px] pt-1 border-t">
                  💡 <code className="bg-muted px-1 py-0.5 rounded">{'{incidentId}'}</code> can be used in URL templates to dynamically insert the incident ID.
                </p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              name="archiveOnResolve"
              defaultChecked={config?.archiveOnResolve ?? true}
              disabled={!isAdmin}
              className="h-4 w-4"
            />
            <Archive className="h-4 w-4 text-muted-foreground" />
            Archive Slack channel on resolve
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {config
                ? `Last updated on ${new Date(config.updatedAt).toLocaleDateString()}`
                : 'No ChatOps configuration yet.'}
            </div>
            <div className="flex gap-2">
              <SubmitButton disabled={!isAdmin} />
            </div>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}

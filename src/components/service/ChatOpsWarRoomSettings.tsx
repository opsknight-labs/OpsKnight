'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Loader2, MessageCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { updateServiceChatOpsSettings } from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';
import type { WarRoomProviderSet, ServiceWarRoomPolicy } from '@/lib/incident-collaboration/types';

const VIDEO_BRIDGE_OPTIONS = [
  { value: 'INHERIT', label: 'Inherit Global' },
  { value: 'JITSI', label: 'Jitsi Meet' },
  { value: 'ZOOM', label: 'Zoom' },
  { value: 'GOOGLE_MEET', label: 'Google Meet' },
  { value: 'NONE', label: 'None' },
];

export type ChatOpsWarRoomSettingsProps = {
  serviceId: string;
  autoCreateWarRoom: boolean;
  warRoomVideoBridge: string | null;
  warRoomCustomBridgeUrl: string | null;
  chatOpsEnabled: boolean;
  canManage: boolean;
  globalDefaultProviders?: WarRoomProviderSet;
  servicePolicy?: ServiceWarRoomPolicy;
  slackDestination?: {
    configured: boolean;
    channelOrWorkspace?: string | null;
  };
  teamsDestination?: {
    configured: boolean;
    teamOrChannelName?: string | null;
  };
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={disabled || pending}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {pending ? 'Saving ChatOps settings...' : 'Save ChatOps settings'}
    </Button>
  );
}

export default function ChatOpsWarRoomSettings({
  serviceId,
  autoCreateWarRoom,
  warRoomVideoBridge,
  warRoomCustomBridgeUrl,
  chatOpsEnabled,
  canManage,
  globalDefaultProviders = ['SLACK', 'MICROSOFT_TEAMS'],
  servicePolicy,
  slackDestination,
  teamsDestination,
}: ChatOpsWarRoomSettingsProps) {
  const [state, formAction] = useActionState(updateServiceChatOpsSettings, {
    error: null,
    success: false,
  });

  const globalDefaultSummary = useMemo(() => {
    const hasSlack = globalDefaultProviders.includes('SLACK');
    const hasTeams = globalDefaultProviders.includes('MICROSOFT_TEAMS');
    if (hasSlack && hasTeams) return 'Both';
    if (hasSlack) return 'Slack';
    if (hasTeams) return 'Microsoft Teams';
    return 'Both';
  }, [globalDefaultProviders]);

  const initialProviderMode = useMemo(() => {
    if (servicePolicy) {
      if (!servicePolicy.warRoomsEnabled) return 'DISABLED';
      if (servicePolicy.serviceProviders === null) return 'INHERIT';
      if (
        servicePolicy.serviceProviders.includes('SLACK') &&
        servicePolicy.serviceProviders.includes('MICROSOFT_TEAMS')
      ) {
        return 'BOTH';
      }
      if (servicePolicy.serviceProviders.includes('SLACK')) return 'SLACK';
      if (servicePolicy.serviceProviders.includes('MICROSOFT_TEAMS')) return 'MICROSOFT_TEAMS';
      if (servicePolicy.serviceProviders.length === 0) return 'DISABLED';
    }
    return 'INHERIT';
  }, [servicePolicy]);

  const [providerMode, setProviderMode] = useState<string>(initialProviderMode);
  const [warRoomsEnabled, setWarRoomsEnabled] = useState<boolean>(
    servicePolicy?.warRoomsEnabled ?? true
  );

  useEffect(() => {
    if (state?.success) {
      notify.success('ChatOps settings saved', { id: `service:${serviceId}:chatops:save` });
    }
    // Errors render as a persistent inline Alert below (field-level recovery context).
    // Do not also toast the same text — one semantic notification per event.
  }, [state, serviceId]);

  const PROVIDER_OPTIONS = [
    {
      value: 'INHERIT',
      label: `Use global default (${globalDefaultSummary})`,
      description: 'Follow workspace-level collaboration default.',
    },
    {
      value: 'SLACK',
      label: 'Slack',
      description: 'Dedicated Slack channels for incident collaboration.',
    },
    {
      value: 'MICROSOFT_TEAMS',
      label: 'Microsoft Teams',
      description: 'Dedicated Microsoft Teams channels for incident collaboration.',
    },
    {
      value: 'BOTH',
      label: 'Both',
      description: 'Simultaneously create Slack & Teams channels.',
    },
    {
      value: 'DISABLED',
      label: 'Disabled',
      description: 'Do not create war rooms for this service.',
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-slate-500" />
              ChatOps & War Room Settings
            </CardTitle>
            <CardDescription>
              Configure incident collaboration channels across Slack and Microsoft Teams, and video
              war rooms for incidents affecting this service.
            </CardDescription>
          </div>
          <Badge variant={chatOpsEnabled ? 'default' : 'secondary'}>
            {chatOpsEnabled ? 'ChatOps Enabled' : 'ChatOps not configured'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="warRoomsEnabled" value={warRoomsEnabled ? 'true' : 'false'} />

          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          {/* Provider Destination Routing Status */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Provider Routing Status
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Slack */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-md bg-muted border border-border/80 shrink-0">
                    <SlackLogo className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">Slack</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {slackDestination?.configured
                        ? slackDestination.channelOrWorkspace || 'Workspace Bot Active'
                        : 'No routing configured'}
                    </div>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${
                    slackDestination?.configured
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-zinc-300 dark:border-zinc-700 text-muted-foreground'
                  }`}
                >
                  {slackDestination?.configured ? 'Destination Ready' : 'Not Routed'}
                </Badge>
              </div>

              {/* Teams */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-md bg-muted border border-border/80 shrink-0">
                    <MicrosoftTeamsLogo className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground truncate">Microsoft Teams</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {teamsDestination?.configured
                        ? teamsDestination.teamOrChannelName || 'War Room Destination Active'
                        : 'No destination routed'}
                    </div>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${
                    teamsDestination?.configured
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-zinc-300 dark:border-zinc-700 text-muted-foreground'
                  }`}
                >
                  {teamsDestination?.configured ? 'Destination Ready' : 'Not Routed'}
                </Badge>
              </div>
            </div>
          </div>

          {/* War Room Provider Selection */}
          <div className="space-y-2.5 pt-2 border-t">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              War Room Provider
            </Label>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {PROVIDER_OPTIONS.map(opt => {
                const isSelected = providerMode === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex flex-col justify-between p-3 rounded-lg border cursor-pointer transition-all text-xs ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-muted/30'
                    } ${!canManage ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground">{opt.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {opt.description}
                      </p>
                    </div>
                    <input
                      type="radio"
                      name="providerMode"
                      value={opt.value}
                      checked={isSelected}
                      onChange={() => {
                        if (!canManage) return;
                        setProviderMode(opt.value);
                        if (opt.value === 'DISABLED') {
                          setWarRoomsEnabled(false);
                        } else {
                          setWarRoomsEnabled(true);
                        }
                      }}
                      disabled={!canManage}
                      className="sr-only"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t">
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="autoCreateWarRoom"
                defaultChecked={autoCreateWarRoom}
                disabled={!canManage || providerMode === 'DISABLED'}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
              />
              <div>
                <div className="font-medium">Auto-create War Room</div>
                <div className="text-xs text-muted-foreground">
                  Automatically spin up dedicated collaboration channels and video bridge when an
                  incident occurs.
                </div>
              </div>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="warRoomVideoBridge">Override Video Bridge</Label>
                <select
                  id="warRoomVideoBridge"
                  name="warRoomVideoBridge"
                  defaultValue={warRoomVideoBridge ?? 'INHERIT'}
                  disabled={!canManage}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {VIDEO_BRIDGE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="warRoomCustomBridgeUrl">Custom Bridge URL</Label>
                <Input
                  id="warRoomCustomBridgeUrl"
                  name="warRoomCustomBridgeUrl"
                  defaultValue={warRoomCustomBridgeUrl ?? ''}
                  placeholder="https://meet.company.com/{incidentId}"
                  disabled={!canManage}
                />
                <p className="text-[11px] text-muted-foreground">
                  Optional. Use <code className="text-xs">{'{incidentId}'}</code> as a placeholder
                  for dynamic room links.
                </p>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex justify-end pt-2">
              <SubmitButton disabled={!canManage} />
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

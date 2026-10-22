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
import { NativeSelect } from '@/components/automation/authoring/primitives';

const VIDEO_BRIDGE_OPTIONS = [
  { value: 'INHERIT', label: 'Inherit Global' },
  { value: 'MICROSOFT_TEAMS', label: 'Microsoft Teams Meeting' },
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
    <Button type="submit" size="sm" className="h-8 text-xs px-3" disabled={disabled || pending}>
      {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
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
    // Default for services: DISABLED (enabling is on user discretion)
    return autoCreateWarRoom ? 'INHERIT' : 'DISABLED';
  }, [servicePolicy, autoCreateWarRoom]);

  const [providerMode, setProviderMode] = useState<string>(initialProviderMode);
  const [warRoomsEnabled, setWarRoomsEnabled] = useState<boolean>(
    servicePolicy ? servicePolicy.warRoomsEnabled : autoCreateWarRoom
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
      label: `Global (${globalDefaultSummary})`,
      description: 'Follow workspace default.',
    },
    {
      value: 'SLACK',
      label: 'Slack',
      description: 'Dedicated Slack channels.',
    },
    {
      value: 'MICROSOFT_TEAMS',
      label: 'Microsoft Teams',
      description: 'Dedicated Teams channels.',
    },
    {
      value: 'BOTH',
      label: 'Both',
      description: 'Simultaneous Slack & Teams.',
    },
    {
      value: 'DISABLED',
      label: 'Disabled',
      description: 'No war rooms for service.',
    },
  ];

  return (
    <Card className="rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
      <CardHeader className="py-2.5 px-3.5 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-xs font-bold flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 border border-primary/20">
                <MessageCircle className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="text-muted-foreground font-mono mr-1 text-[11px]">3.</span>
                <span>ChatOps & War Room Settings</span>
              </div>
            </CardTitle>
            <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
              Configure incident collaboration channels across Slack and Microsoft Teams, and video
              war rooms for incidents.
            </CardDescription>
          </div>
          <Badge
            variant={chatOpsEnabled ? 'default' : 'secondary'}
            className="text-[10px] font-semibold self-start sm:self-auto shrink-0"
          >
            {chatOpsEnabled ? 'ChatOps Enabled' : 'ChatOps not configured'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-3.5">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="warRoomsEnabled" value={warRoomsEnabled ? 'true' : 'false'} />

          {state?.error && (
            <Alert variant="destructive" className="py-2 text-xs">
              <XCircle className="h-3.5 w-3.5" />
              <AlertDescription className="text-xs">{state.error}</AlertDescription>
            </Alert>
          )}

          {/* Provider Destination Routing Status */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              Provider Routing Status
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {/* Slack */}
              <div className="min-w-0 flex items-center justify-between p-2 px-2.5 rounded-lg border bg-muted/15 text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="p-1 rounded-md bg-muted border border-border/80 shrink-0">
                    <SlackLogo className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1 flex items-center gap-1">
                    <span className="font-semibold text-foreground text-xs shrink-0">Slack:</span>
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {slackDestination?.configured
                        ? slackDestination.channelOrWorkspace || 'Workspace Bot Active'
                        : 'No routing configured'}
                    </span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 font-medium px-1.5 py-0.2 ${
                    slackDestination?.configured
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {slackDestination?.configured ? 'Destination Ready' : 'Not Routed'}
                </Badge>
              </div>

              {/* Teams */}
              <div className="min-w-0 flex items-center justify-between p-2 px-2.5 rounded-lg border bg-muted/15 text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="p-1 rounded-md bg-muted border border-border/80 shrink-0">
                    <MicrosoftTeamsLogo className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1 flex items-center gap-1">
                    <span className="font-semibold text-foreground text-xs shrink-0">Teams:</span>
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {teamsDestination?.configured
                        ? teamsDestination.teamOrChannelName || 'War Room Destination Active'
                        : 'No destination routed'}
                    </span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[9px] shrink-0 font-medium px-1.5 py-0.2 ${
                    teamsDestination?.configured
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {teamsDestination?.configured ? 'Destination Ready' : 'Not Routed'}
                </Badge>
              </div>
            </div>
          </div>

          {/* War Room Provider Selection */}
          <div className="space-y-1.5 pt-1.5 border-t border-border/60">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
              War Room Provider
            </Label>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {PROVIDER_OPTIONS.map(opt => {
                const isSelected = providerMode === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`min-w-0 flex flex-col justify-between p-2 px-2.5 rounded-lg border cursor-pointer transition-all text-xs select-none ${
                      isSelected
                        ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                        : 'border-border/80 bg-card hover:bg-muted/30 text-muted-foreground'
                    } ${!canManage ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <span className="font-bold text-xs text-foreground truncate">
                          {opt.label}
                        </span>
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
                          className="h-3 w-3 accent-primary shrink-0"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">
                        {opt.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5 pt-1.5 border-t border-border/60">
            <label className="flex items-center gap-2.5 rounded-lg border p-2 px-3 text-xs cursor-pointer select-none bg-card hover:bg-muted/20">
              <input
                type="checkbox"
                name="autoCreateWarRoom"
                defaultChecked={servicePolicy?.autoCreate ?? autoCreateWarRoom}
                disabled={!canManage || providerMode === 'DISABLED'}
                className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-foreground text-xs">Auto-create War Room</span>
                <span className="text-[11px] text-muted-foreground ml-2 hidden sm:inline">
                  — Automatically spin up dedicated channels and video bridge when an incident
                  occurs.
                </span>
                <p className="text-[10px] text-muted-foreground sm:hidden mt-0.5">
                  Spin up dedicated channels and video bridge on incidents.
                </p>
              </div>
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label
                  htmlFor="warRoomVideoBridge"
                  className="text-[11px] font-semibold text-foreground"
                >
                  Override Video Bridge
                </Label>
                <NativeSelect
                  id="warRoomVideoBridge"
                  name="warRoomVideoBridge"
                  defaultValue={warRoomVideoBridge ?? 'INHERIT'}
                  disabled={!canManage}
                  className="h-8 text-xs"
                >
                  {VIDEO_BRIDGE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="warRoomCustomBridgeUrl"
                  className="text-[11px] font-semibold text-foreground"
                >
                  Custom Bridge URL
                </Label>
                <Input
                  id="warRoomCustomBridgeUrl"
                  name="warRoomCustomBridgeUrl"
                  defaultValue={warRoomCustomBridgeUrl ?? ''}
                  placeholder="https://meet.company.com/{incidentId}"
                  disabled={!canManage}
                  className="h-8 text-xs font-mono"
                />
                <p className="text-[10px] text-muted-foreground">
                  Use <code className="text-[10px] px-1 bg-muted rounded">{'{incidentId}'}</code> as
                  placeholder.
                </p>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex justify-end pt-1 border-t border-border/60">
              <SubmitButton disabled={!canManage} />
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

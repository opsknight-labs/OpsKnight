'use client';

import React from 'react';
import Link from 'next/link';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

export type ProviderStatusProps = {
  slack: {
    connected: boolean;
    workspaceName?: string | null;
  };
  teams: {
    connected: boolean;
    warRoomsEnabled: boolean;
    destinationsCount: number;
  };
};

export function WarRoomProviderStatus({ slack, teams }: ProviderStatusProps) {
  const anyConnected = slack.connected || teams.connected;

  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Connected Providers</h3>
          <p className="text-xs text-muted-foreground">
            Collaboration platforms configured for incident rooms and ChatOps.
          </p>
        </div>
      </div>

      {!anyConnected && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              No collaboration provider is configured yet
            </p>
            <p className="text-muted-foreground">
              Connect Slack or configure Microsoft Teams to start creating real-time war rooms.
              Auto-create rules will take effect when an eligible provider is active.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <Link href="/settings/integrations/slack">
                <SlackLogo className="h-3.5 w-3.5" />
                <span>Connect Slack</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <Link href="/settings/integrations/microsoft-teams">
                <MicrosoftTeamsLogo className="h-3.5 w-3.5" />
                <span>Configure Teams</span>
              </Link>
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2">
        {/* Slack Card */}
        <div className="rounded-lg border border-border p-4 bg-muted/20 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-muted border border-border/80 shrink-0">
                <SlackLogo className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-foreground">Slack</h4>
                <p className="text-[11px] text-muted-foreground">Incident channels & Bot</p>
              </div>
            </div>
            <Badge variant={slack.connected ? 'default' : 'secondary'} className="text-[10px]">
              {slack.connected ? 'Connected' : 'Not configured'}
            </Badge>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {slack.connected
              ? 'Ready for automatic and manual war room provisioning with real-time incident cards.'
              : 'Install the OpsKnight Slack app to enable channel automation and responder messaging.'}
          </p>

          <div className="pt-1 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              {slack.connected ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span>War Rooms available</span>
                </>
              ) : (
                <span>Channel creation disabled</span>
              )}
            </span>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2">
              <Link href="/settings/integrations/slack">
                <span>Manage Slack</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Microsoft Teams Card */}
        <div className="rounded-lg border border-border p-4 bg-muted/20 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-muted border border-border/80 shrink-0">
                <MicrosoftTeamsLogo className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-foreground">Microsoft Teams</h4>
                <p className="text-[11px] text-muted-foreground">Tenant & Channel collaboration</p>
              </div>
            </div>
            <Badge
              variant={teams.connected && teams.warRoomsEnabled ? 'default' : 'secondary'}
              className="text-[10px]"
            >
              {teams.connected && teams.warRoomsEnabled
                ? 'Connected'
                : teams.connected
                  ? 'War Rooms Disabled'
                  : 'Not configured'}
            </Badge>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {teams.connected && teams.warRoomsEnabled
              ? `Standard & private channels with RSC permissions. ${teams.destinationsCount} mapped destination(s).`
              : teams.connected
                ? 'Connected to Microsoft Entra. War room creation is currently disabled in Teams settings.'
                : 'Connect Microsoft 365 Entra tenant to enable Teams war rooms and incident channels.'}
          </p>

          <div className="pt-1 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              {teams.connected && teams.warRoomsEnabled ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span>War Rooms available</span>
                </>
              ) : (
                <span>Channel creation disabled</span>
              )}
            </span>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2">
              <Link href="/settings/integrations/microsoft-teams">
                <span>Manage Teams</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

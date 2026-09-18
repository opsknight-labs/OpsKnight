'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Loader2, Plus, MessageSquare } from 'lucide-react';
import type {
  IncidentWarRoomProviderView,
  WarRoomProviderName,
} from '@/lib/incident-collaboration/types';
import { getProviderPresentation } from '@/lib/incident-collaboration/presentation';

type WarRoomCreateDialogProps = {
  providers: IncidentWarRoomProviderView[];
  privacyRequirement?: 'STANDARD' | 'PRIVATE';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (
    provider: WarRoomProviderName,
    options?: { membershipType?: 'STANDARD' | 'PRIVATE' }
  ) => Promise<void> | void;
  isPending?: boolean;
};

export function WarRoomCreateDialog({
  providers,
  privacyRequirement: _privacyRequirement,
  open,
  onOpenChange,
  onCreate,
  isPending,
}: WarRoomCreateDialogProps) {
  // Only providers that currently allow creation
  const creatableProviders = providers.filter(p => p.canCreate);
  const [activeProviderTrigger, setActiveProviderTrigger] = useState<WarRoomProviderName | null>(
    null
  );

  const handleCreate = async (provider: WarRoomProviderName) => {
    setActiveProviderTrigger(provider);
    const options = { membershipType: 'STANDARD' as const };
    try {
      await onCreate(provider, options);
      onOpenChange(false);
    } finally {
      setActiveProviderTrigger(null);
    }
  };

  if (creatableProviders.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Incident War Room</DialogTitle>
          <DialogDescription>
            Spin up a dedicated real-time collaboration channel with automatic responder syncing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {creatableProviders.map(providerView => {
            const meta = getProviderPresentation(providerView.provider);
            const isTeams = providerView.provider === 'MICROSOFT_TEAMS';
            const isSlack = providerView.provider === 'SLACK';
            const isThisPending = isPending && activeProviderTrigger === providerView.provider;

            return (
              <div
                key={providerView.provider}
                className="rounded-xl border border-border p-4 bg-card space-y-3 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {isSlack ? (
                      <SlackLogo className="h-5 w-5 shrink-0" />
                    ) : isTeams ? (
                      <MicrosoftTeamsLogo className="h-6 w-6 shrink-0" />
                    ) : (
                      <MessageSquare className="h-5 w-5 text-muted-foreground shrink-0" />
                    )}
                    <div>
                      <h4 className="font-semibold text-sm text-foreground">{meta.displayName}</h4>
                      <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
                    </div>
                  </div>
                </div>

                <div className="pt-1 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => handleCreate(providerView.provider)}
                    disabled={Boolean(isPending)}
                    className="min-h-9 px-4 font-medium"
                  >
                    {isThisPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        <span>Creating…</span>
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1.5" />
                        <span>Create {meta.displayName} room</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

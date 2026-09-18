'use client';

import React from 'react';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Check, Minus } from 'lucide-react';

const CAPABILITY_ROWS = [
  {
    key: 'createRoom',
    label: 'Room creation',
    desc: 'Create dedicated collaboration channels for incidents',
  },
  {
    key: 'privateRooms',
    label: 'Private rooms',
    desc: 'Restricted-access channels with scoped responder membership',
  },
  {
    key: 'manageMembers',
    label: 'Responder sync',
    desc: 'Automatically add on-call responders and incident assignees',
  },
  {
    key: 'interactiveProjection',
    label: 'Interactive ChatOps',
    desc: 'In-channel actionable cards with incident status controls',
  },
  {
    key: 'projectionUpdates',
    label: 'Projection updates',
    desc: 'Real-time card sync on severity, status, and responder changes',
  },
  {
    key: 'archiveRoom',
    label: 'Channel archiving',
    desc: 'Provider-native archive of channels upon incident resolution',
  },
  {
    key: 'reconciliation',
    label: 'Automated reconciliation',
    desc: 'Background drift detection and state healing',
  },
];

export function WarRoomProviderCapabilities() {
  // Provider capabilities derived from registered adapter contracts
  const slackCaps: Record<string, boolean> = {
    createRoom: true,
    privateRooms: false,
    manageMembers: true,
    interactiveProjection: true,
    projectionUpdates: true,
    archiveRoom: true,
    reconciliation: true,
  };

  const teamsCaps: Record<string, boolean> = {
    createRoom: true,
    privateRooms: false,
    manageMembers: true,
    interactiveProjection: true,
    projectionUpdates: true,
    archiveRoom: false,
    reconciliation: true,
  };

  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Provider Capabilities</h3>
          <p className="text-xs text-muted-foreground">
            Feature availability by collaboration provider based on registered adapter contracts.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left font-medium py-2.5 pr-4">Capability</th>
              <th className="text-center font-medium py-2.5 px-3 w-28">
                <span className="inline-flex items-center gap-1.5 justify-center">
                  <SlackLogo className="h-3.5 w-3.5 shrink-0" />
                  <span>Slack</span>
                </span>
              </th>
              <th className="text-center font-medium py-2.5 px-3 w-28">
                <span className="inline-flex items-center gap-1.5 justify-center">
                  <MicrosoftTeamsLogo className="h-3.5 w-3.5 shrink-0" />
                  <span>Teams</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {CAPABILITY_ROWS.map(row => (
              <tr key={row.key} className="hover:bg-muted/30 transition-colors">
                <td className="py-2.5 pr-4">
                  <span className="font-semibold text-foreground block">{row.label}</span>
                  <span className="text-[11px] text-muted-foreground">{row.desc}</span>
                </td>
                <td className="text-center py-2.5 px-3">
                  {slackCaps[row.key] ? (
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mx-auto">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center text-muted-foreground/50 mx-auto">
                      <Minus className="h-3.5 w-3.5" />
                    </span>
                  )}
                </td>
                <td className="text-center py-2.5 px-3">
                  {teamsCaps[row.key] ? (
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mx-auto">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center text-muted-foreground/50 mx-auto">
                      <Minus className="h-3.5 w-3.5" />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

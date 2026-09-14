'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { ExternalLink, Loader2, RefreshCw, SquareX } from 'lucide-react';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';

type Room = {
  id: string;
  generation: number;
  state: string;
  providerChannelName: string | null;
  providerChannelUrl: string | null;
  membershipType: string | null;
  health?: string;
  lastErrorCode?: string | null;
  lastReconciledAt?: Date | null;
  lastError: string | null;
  participants: Array<{ id: string; source: string; state: string; lastError: string | null; user: { name: string | null } | null }>;
};

function message(error: unknown, fallback: string) {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description ? `${friendly.title} ${friendly.description}` : friendly.title;
}

export default function MicrosoftTeamsWarRoomsPanel({
  incidentId, rooms, canManage, enabled, unavailableReason,
}: { incidentId: string; rooms: Room[]; canManage: boolean; enabled: boolean; unavailableReason?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const latest = rooms[0] ?? null;

  const run = (path: string, body?: unknown) => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(path, {
          method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) throw await errorFromResponse(response, 'War-room operation failed');
        router.refresh();
      } catch (cause) {
        setError(message(cause, 'War-room operation failed'));
      }
    });
  };

  const active = latest?.state === 'READY';
  const ambiguous = latest?.state === 'AMBIGUOUS';

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm space-y-4" aria-label="Microsoft Teams war rooms">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MicrosoftTeamsLogo className="h-5 w-5" />
          <div>
            <h2 className="text-sm font-semibold">Microsoft Teams war room</h2>
            <p className="text-xs text-muted-foreground">A durable, generation-aware collaboration room for this incident.</p>
          </div>
        </div>
        {latest && <Badge variant="outline" className={active ? 'border-emerald-300 text-emerald-700' : ambiguous ? 'border-amber-300 text-amber-700' : ''}>{latest.state}</Badge>}
      </div>

      {!latest ? (
        <p className="text-sm text-muted-foreground">No Microsoft Teams war room has been requested.</p>
      ) : (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Generation {latest.generation}</span>
            {latest.membershipType && <Badge variant="secondary">{latest.membershipType.toLowerCase()}</Badge>}
            {active && latest.providerChannelUrl && (
              <a href={latest.providerChannelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {latest.providerChannelName ?? 'Open Teams channel'} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {latest.health && latest.health !== 'HEALTHY' && <Badge variant="outline" className="border-amber-300 text-amber-700">{latest.health.toLowerCase().replace('_', ' ')}</Badge>}
          </div>
          {latest.participants.length > 0 && <p className="text-xs text-muted-foreground">Responder projection: {latest.participants.map(participant => `${participant.user?.name ?? 'Unlinked responder'} (${participant.state.toLowerCase()})`).join(', ')}</p>}
          {latest.lastError && <p className="text-xs text-amber-700 dark:text-amber-300">{latest.lastError}</p>}
          {ambiguous && <p className="text-xs text-amber-700 dark:text-amber-300">This room is reconciling a possibly completed create. It cannot be closed or recreated until reconciliation establishes its outcome.</p>}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {!active && !ambiguous && enabled && <Button size="sm" disabled={pending} onClick={() => run(`/api/incidents/${incidentId}/war-rooms/microsoft-teams`)}>{pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MicrosoftTeamsLogo className="mr-1 h-3.5 w-3.5" />}{latest ? 'Create new generation' : 'Create Teams war room'}</Button>}
          {ambiguous && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/reconcile`)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Reconcile Teams channel</Button>}
          {active && <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/sync`)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh responder plan</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/project`)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh command card</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/close`)}><SquareX className="mr-1 h-3.5 w-3.5" />Close room</Button>
          </>}
          {!enabled && !latest && <span className="text-xs text-muted-foreground">{unavailableReason ?? 'Teams war-room creation is unavailable for this service.'}</span>}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {rooms.length > 1 && <details className="rounded-lg border p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">War-room history ({rooms.length} generations)</summary><ul className="mt-2 space-y-1">{rooms.slice(1).map(room => <li key={room.id}>Generation {room.generation}: {room.state}{room.providerChannelName ? ` · ${room.providerChannelName}` : ''}</li>)}</ul></details>}
    </section>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { ExternalLink, Loader2, RefreshCw, SquareX } from 'lucide-react';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { fetchWithTimeout } from '@/lib/client-timeout';

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
  participants: Array<{
    id: string;
    source: string;
    state: string;
    lastError: string | null;
    user: { name: string | null } | null;
  }>;
};

/** Own-key lookup so values like "constructor" never resolve to prototype members. */
const pick = <T,>(map: Record<string, T>, key: string): T | undefined =>
  // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed constant table
  Object.hasOwn(map, key) ? map[key] : undefined;

const STATE_COPY: Record<string, { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  PROVISIONING: { label: 'Setting up', tone: 'neutral' },
  READY: { label: 'Ready', tone: 'ok' },
  CLOSING: { label: 'Closing', tone: 'neutral' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
  FAILED: { label: 'Couldn’t be created', tone: 'warn' },
  AMBIGUOUS: { label: 'Checking with Teams', tone: 'warn' },
};

const HEALTH_COPY: Record<string, string> = {
  DEGRADED: 'Some updates aren’t reaching Teams',
  MISSING: 'Channel missing in Teams',
  PERMISSION_ERROR: 'Permission needed',
};

const PARTICIPANT_COPY: Record<string, string> = {
  PRESENT: 'in the channel',
  DESIRED: 'being added',
  PENDING: 'being added',
  PROCESSING: 'being added',
  SKIPPED: 'not added',
  FAILED: 'couldn’t be added',
  REMOVED: 'removed',
};

const ERROR_COPY: Record<string, string> = {
  AMBIGUOUS_CARD_CREATE:
    'The incident card may not have reached the channel. If it’s missing in Teams, create a replacement card.',
  PROJECTION_RETRIES_EXHAUSTED:
    'The incident card in Teams couldn’t be updated. Try Refresh incident card.',
  CARD_UPDATE_FAILED: 'The incident card in Teams couldn’t be updated. Try Refresh incident card.',
  CREATE_RECONCILIATION_EXHAUSTED:
    'OpsKnight couldn’t confirm whether Teams created the channel. Check Teams, then create a new war room if it’s missing.',
  RECONCILIATION_EXPIRED_UNVERIFIED:
    'OpsKnight couldn’t confirm whether Teams created the channel. Check Teams, then create a new war room if it’s missing.',
  AMBIGUOUS_SIDE_EFFECT: 'OpsKnight is checking with Teams whether the last change went through.',
  CREATE_OUTCOME_RECONCILING: 'OpsKnight is checking with Teams whether the channel was created.',
  WAR_ROOM_ROUTING_MISSING:
    'This service has no Teams team set for war rooms. Choose one on the service’s Notifications tab.',
  INCIDENT_RESOLVED_DURING_CREATE: 'The incident was resolved while the room was being set up.',
  INCIDENT_RESOLVED: 'The incident is resolved, so the room was closed.',
  CLOSE_PROJECTION_DEGRADED: 'The room was closed, but the final card update didn’t reach Teams.',
  CLOSE_AMBIGUOUS: 'OpsKnight is checking with Teams whether the room was closed.',
  DATABASE_COMMIT_FAILED: 'OpsKnight couldn’t save the room. Try again.',
  TEAMS_CHANNEL_LIMIT_REACHED:
    'This Team has reached Microsoft’s channel limit. Permanently delete old channels or route war rooms to another Team.',
  TEAMS_CHANNEL_LIMIT_NEAR:
    'This Team is close to Microsoft’s channel limit of 1,000 (archived channels count). Delete old channels permanently or route war rooms to another Team soon.',
  TEAMS_CHANNEL_LIMIT:
    'This Team has reached Microsoft’s channel limit. Permanently delete old channels or route war rooms to another Team.',
  CHANNEL_LIMIT_REACHED:
    'This Team has reached Microsoft’s channel limit. Permanently delete old channels or route war rooms to another Team.',
};

/** Plain-English explanation of a room's last problem; raw provider text stays in "details". */
export function describeTeamsWarRoomProblem(room: {
  state: string;
  health?: string;
  lastErrorCode?: string | null;
  lastError: string | null;
}): string | null {
  const code = room.lastErrorCode ?? '';
  const known = pick(ERROR_COPY, code);
  if (known) return known;
  if (/RATE_LIMIT/.test(code))
    return 'Teams is rate limiting OpsKnight. It will retry automatically.';
  if (/PERMISSION|CONSENT|FORBIDDEN|AUTHORITY/.test(code) || room.health === 'PERMISSION_ERROR')
    return 'OpsKnight doesn’t have permission in this Team. A Team owner needs to update the OpsKnight app.';
  if (room.health === 'MISSING')
    return 'The channel was deleted or archived in Teams. Create a new war room if you still need one.';
  if (room.state === 'AMBIGUOUS')
    return 'OpsKnight isn’t sure whether Teams finished creating the channel. Use Check status with Teams; you can close or recreate the room once that’s settled.';
  if (room.lastError || code || room.state === 'FAILED')
    return 'Something went wrong with this room. OpsKnight keeps retrying; if it persists, check Settings → Microsoft Teams → Health.';
  return null;
}

function message(error: unknown, fallback: string) {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description ? `${friendly.title} ${friendly.description}` : friendly.title;
}

export default function MicrosoftTeamsWarRoomsPanel({
  incidentId,
  rooms,
  canManage,
  enabled,
  unavailableReason,
}: {
  incidentId: string;
  rooms: Room[];
  canManage: boolean;
  enabled: boolean;
  unavailableReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const latest = rooms[0] ?? null;

  const run = (path: string, body?: unknown) => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetchWithTimeout(
          path,
          {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          },
          15_000
        );
        if (!response.ok) throw await errorFromResponse(response, 'War-room operation failed');
        router.refresh();
      } catch (cause) {
        setError(message(cause, 'War-room operation failed'));
      }
    });
  };

  const active = latest?.state === 'READY';
  const ambiguous = latest?.state === 'AMBIGUOUS';
  const hasAmbiguousCard = active && latest?.lastErrorCode === 'AMBIGUOUS_CARD_CREATE';
  const stateCopy = latest
    ? (pick(STATE_COPY, latest.state) ?? { label: latest.state, tone: 'neutral' })
    : null;
  const problem = latest ? describeTeamsWarRoomProblem(latest) : null;

  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-xs space-y-4"
      aria-label="Microsoft Teams war rooms"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MicrosoftTeamsLogo className="h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Microsoft Teams war room</h2>
            <p className="text-xs text-muted-foreground">
              A dedicated Teams channel where responders work on this incident.
            </p>
          </div>
        </div>
        {latest && stateCopy && (
          <Badge
            variant="outline"
            className={
              stateCopy.tone === 'ok'
                ? 'border-emerald-300 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300'
                : stateCopy.tone === 'warn'
                  ? 'border-amber-300 text-amber-700 dark:border-amber-500/30 dark:text-amber-300'
                  : ''
            }
          >
            <span className="sr-only">War room status: </span>
            {stateCopy.label}
          </Badge>
        )}
      </div>

      {!latest ? (
        <p className="text-sm text-muted-foreground">
          No Microsoft Teams war room has been requested.
        </p>
      ) : (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {rooms.length > 1 ? `Room ${latest.generation}` : 'Current room'}
            </span>
            {latest.membershipType && (
              <Badge variant="secondary">
                {latest.membershipType === 'PRIVATE' ? 'Private channel' : 'Standard channel'}
              </Badge>
            )}
            {active && latest.providerChannelUrl && (
              <a
                href={latest.providerChannelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {latest.providerChannelName ?? 'Open Teams channel'}{' '}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(opens in Microsoft Teams)</span>
              </a>
            )}
            {latest.health && latest.health !== 'HEALTHY' && (
              <Badge
                variant="outline"
                className="border-amber-300 text-amber-700 dark:border-amber-500/30 dark:text-amber-300"
              >
                {pick(HEALTH_COPY, latest.health) ?? latest.health.toLowerCase().replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
          {latest.participants.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Responders:{' '}
              {latest.participants
                .map(
                  participant =>
                    `${participant.user?.name ?? 'Responder without a linked Teams account'} (${pick(PARTICIPANT_COPY, participant.state) ?? participant.state.toLowerCase()})`
                )
                .join(', ')}
            </p>
          )}
          {problem && <p className="text-xs text-amber-700 dark:text-amber-300">{problem}</p>}
          {latest.lastError && (
            <details className="text-2xs text-muted-foreground">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 font-mono wrap-break-word">
                {latest.lastErrorCode ? `${latest.lastErrorCode}: ` : ''}
                {latest.lastError}
              </p>
            </details>
          )}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {!active && !ambiguous && enabled && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(`/api/incidents/${incidentId}/war-rooms/microsoft-teams`)}
            >
              {pending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <MicrosoftTeamsLogo className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              )}
              {latest ? 'Create a new war room' : 'Create Teams war room'}
            </Button>
          )}
          {ambiguous && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/reconcile`)}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Check status with Teams
            </Button>
          )}
          {active && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/sync`)}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Sync responders
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/project`)}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Refresh incident card
              </Button>
              {hasAmbiguousCard && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setShowAbandonConfirm(true)}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Create replacement card
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/close`)}
              >
                <SquareX className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Close room
              </Button>
            </>
          )}
          {!enabled && !latest && (
            <span className="text-xs text-muted-foreground">
              {unavailableReason ?? 'Teams war-room creation is unavailable for this service.'}
            </span>
          )}
        </div>
      )}
      <AlertDialog open={showAbandonConfirm} onOpenChange={setShowAbandonConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create replacement card?</AlertDialogTitle>
            <AlertDialogDescription>
              Teams may already contain the original card. Creating a replacement can result in a
              duplicate card in the channel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                setShowAbandonConfirm(false);
                if (latest) run(`/api/incidents/${incidentId}/war-rooms/${latest.id}/abandon`);
              }}
            >
              Create replacement card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {rooms.length > 1 && (
        <details className="rounded-lg border p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            Earlier war rooms ({rooms.length - 1})
          </summary>
          <ul className="mt-2 space-y-1">
            {rooms.slice(1).map(room => (
              <li key={room.id}>
                Room {room.generation}: {pick(STATE_COPY, room.state)?.label ?? room.state}
                {room.providerChannelName ? ` · ${room.providerChannelName}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import { MessageCircle, Video, ExternalLink, Archive, Hash, Loader2 } from 'lucide-react';

interface IncidentWarRoomCardProps {
  incident: {
    id: string;
    slackChannelId: string | null;
    slackChannelName: string | null;
    warRoomUrl: string | null;
    warRoomArchivedAt: Date | string | null;
    status: string;
    service: {
      name: string;
    };
  };
  canManage: boolean;
}

function displayError(error: unknown, fallback: string): string {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description ? `${friendly.title} ${friendly.description}` : friendly.title;
}

export default function IncidentWarRoomCard({ incident, canManage }: IncidentWarRoomCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleCreateWarRoom = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/slack/war-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incidentId: incident.id, action: 'create' }),
        });

        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to create war-room');
        }

        // Refresh page to show updated war-room state
        router.refresh();
      } catch (err: unknown) {
        setError(displayError(err, 'Failed to create war-room'));
      }
    });
  };

  const handleArchiveWarRoom = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/slack/war-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incidentId: incident.id, action: 'archive' }),
        });

        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to archive war-room');
        }

        // Refresh page to show updated war-room state
        router.refresh();
      } catch (err: unknown) {
        setError(displayError(err, 'Failed to archive war-room'));
      }
    });
  };

  const isArchived = Boolean(incident.warRoomArchivedAt);
  // An archived channel is history, not an active war-room — the channel id is
  // retained deliberately, so presence alone must not imply "live".
  const hasWarRoom = Boolean(incident.slackChannelId) && !isArchived;
  const isResolved = incident.status === 'RESOLVED';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-blue-600" />
            Slack War-Room
          </div>
          {hasWarRoom && (
            <div className="h-2 w-2 rounded-full bg-green-500" title="Active War-Room" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasWarRoom && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-muted-foreground">
            <p className="mb-3">
              {isArchived
                ? `War-Room #${incident.slackChannelName ?? 'channel'} was archived.`
                : 'No War-Room active for this incident.'}
            </p>
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8"
                onClick={handleCreateWarRoom}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <MessageCircle className="mr-1.5 h-3 w-3" />
                )}
                {isArchived ? 'Create New War-Room' : 'Create War-Room'}
              </Button>
            )}
            {error && <p className="text-destructive text-xs mt-2">{error}</p>}
          </div>
        )}

        {hasWarRoom && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-lg border p-2.5 text-sm">
              <div className="flex items-center justify-between">
                <a
                  href={`slack://channel?team=&id=${incident.slackChannelId}`}
                  className="font-medium text-blue-600 hover:underline flex items-center gap-1.5"
                >
                  <Badge
                    variant="secondary"
                    className="font-mono bg-blue-50 text-blue-700 hover:bg-blue-100"
                  >
                    <Hash className="h-3 w-3 mr-1" />
                    {incident.slackChannelName || 'channel'}
                  </Badge>
                  <ExternalLink className="h-3 w-3" />
                </a>

                {canManage && isResolved && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={handleArchiveWarRoom}
                    disabled={isPending}
                    title="Archive Channel"
                    aria-label="Archive war-room channel"
                  >
                    {isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Archive className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                <a
                  href={`https://slack.com/app_redirect?channel=${incident.slackChannelId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline flex items-center gap-1"
                >
                  Open in Web Browser <ExternalLink className="h-2 w-2" />
                </a>
              </div>

              {incident.warRoomUrl && (
                <div className="pt-2 mt-1 border-t">
                  <Button asChild variant="outline" size="sm" className="w-full h-8 bg-white">
                    <a href={incident.warRoomUrl} target="_blank" rel="noopener noreferrer">
                      <Video className="mr-1.5 h-3 w-3 text-indigo-500" />
                      Join Video Bridge
                    </a>
                  </Button>
                </div>
              )}
            </div>
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

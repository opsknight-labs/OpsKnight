'use client';

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
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { updateServiceChatOpsSettings } from '@/app/(app)/services/actions';

const VIDEO_BRIDGE_OPTIONS = [
  { value: 'INHERIT', label: 'Inherit Global' },
  { value: 'JITSI', label: 'Jitsi Meet' },
  { value: 'ZOOM', label: 'Zoom' },
  { value: 'GOOGLE_MEET', label: 'Google Meet' },
  { value: 'NONE', label: 'None' },
];

export default function ChatOpsWarRoomSettings({
  serviceId,
  autoCreateWarRoom,
  warRoomVideoBridge,
  warRoomCustomBridgeUrl,
  chatOpsEnabled,
  canManage,
}: {
  serviceId: string;
  autoCreateWarRoom: boolean;
  warRoomVideoBridge: string | null;
  warRoomCustomBridgeUrl: string | null;
  chatOpsEnabled: boolean;
  canManage: boolean;
}) {
  const saveChatOpsSettings = updateServiceChatOpsSettings.bind(null, serviceId);

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
              Configure Slack channel creation and video war rooms for incidents affecting this
              service.
            </CardDescription>
          </div>
          <Badge variant={chatOpsEnabled ? 'default' : 'secondary'}>
            {chatOpsEnabled ? 'ChatOps Enabled' : 'ChatOps not configured'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form action={saveChatOpsSettings} className="space-y-4">
          <div className="space-y-4">
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                name="autoCreateWarRoom"
                defaultChecked={autoCreateWarRoom}
                disabled={!canManage}
                className="h-4 w-4"
              />
              Auto-create War Room
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
              </div>
            </div>
          </div>
          {canManage && (
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Save ChatOps settings
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

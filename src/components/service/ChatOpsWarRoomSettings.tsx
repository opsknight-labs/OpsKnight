'use client';

import { useActionState, useEffect } from 'react';
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
import { CheckCircle2, Loader2, MessageCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { updateServiceChatOpsSettings } from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';

const VIDEO_BRIDGE_OPTIONS = [
  { value: 'INHERIT', label: 'Inherit Global' },
  { value: 'JITSI', label: 'Jitsi Meet' },
  { value: 'ZOOM', label: 'Zoom' },
  { value: 'GOOGLE_MEET', label: 'Google Meet' },
  { value: 'NONE', label: 'None' },
];

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
}: {
  serviceId: string;
  autoCreateWarRoom: boolean;
  warRoomVideoBridge: string | null;
  warRoomCustomBridgeUrl: string | null;
  chatOpsEnabled: boolean;
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(updateServiceChatOpsSettings, {
    error: null,
    success: false,
  });

  useEffect(() => {
    if (state?.success) {
      notify.success('ChatOps settings saved');
    } else if (state?.error) {
      notify.error(state.error);
    }
  }, [state]);

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
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="serviceId" value={serviceId} />

          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          {state?.success && (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription>ChatOps & war room settings saved.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="autoCreateWarRoom"
                defaultChecked={autoCreateWarRoom}
                disabled={!canManage}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <div>
                <div className="font-medium">Auto-create War Room</div>
                <div className="text-xs text-muted-foreground">
                  Automatically spin up dedicated Slack channel and video bridge when an incident
                  occurs.
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
            <div className="flex justify-end">
              <SubmitButton disabled={!canManage} />
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

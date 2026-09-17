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
import { Loader2, MessageCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { updateServiceChatOpsSettings } from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';
import { SlackLogo } from '@/components/common/BrandLogos';

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
      notify.success('ChatOps settings saved', { id: `service:${serviceId}:chatops:save` });
    }
    // Errors render as a persistent inline Alert below (field-level recovery context).
    // Do not also toast the same text — one semantic notification per event.
  }, [state, serviceId]);

  return (
    <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
      <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <span className="text-muted-foreground font-mono mr-1.5 text-xs">3.</span>
                <span>ChatOps & War Room Settings</span>
              </div>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Configure Slack channel creation and video war rooms for incidents affecting this
              service.
            </CardDescription>
          </div>
          <Badge
            variant={chatOpsEnabled ? 'default' : 'secondary'}
            className="text-[10px] font-semibold w-fit px-2.5 py-0.5 inline-flex items-center gap-1.5"
          >
            <SlackLogo className="h-3 w-3 shrink-0" />
            <span>{chatOpsEnabled ? 'ChatOps Enabled' : 'ChatOps not configured'}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="serviceId" value={serviceId} />

          {state?.error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <label className="flex items-center gap-3 rounded-xl border border-border/80 bg-muted/20 p-3.5 text-xs cursor-pointer hover:bg-muted/30 transition-colors">
              <input
                type="checkbox"
                name="autoCreateWarRoom"
                defaultChecked={autoCreateWarRoom}
                disabled={!canManage}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
              />
              <div>
                <div className="font-semibold text-foreground text-xs">Auto-create War Room</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Automatically spin up dedicated Slack channel and video bridge when an incident
                  occurs.
                </div>
              </div>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="warRoomVideoBridge" className="text-xs font-semibold">
                  Override Video Bridge
                </Label>
                <select
                  id="warRoomVideoBridge"
                  name="warRoomVideoBridge"
                  defaultValue={warRoomVideoBridge ?? 'INHERIT'}
                  disabled={!canManage}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {VIDEO_BRIDGE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="warRoomCustomBridgeUrl" className="text-xs font-semibold">
                  Custom Bridge URL
                </Label>
                <Input
                  id="warRoomCustomBridgeUrl"
                  name="warRoomCustomBridgeUrl"
                  defaultValue={warRoomCustomBridgeUrl ?? ''}
                  placeholder="https://meet.company.com/{incidentId}"
                  disabled={!canManage}
                  className="text-xs h-9"
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

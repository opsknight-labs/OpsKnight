'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Plus, Webhook, Loader2, AlertCircle } from 'lucide-react';
import { createWebhookIntegration } from '@/app/(app)/services/[id]/webhooks/actions';
import { notify } from '@/lib/toast';

interface AddWebhookDialogProps {
  serviceId: string;
}

const WEBHOOK_TYPES = [
  { value: 'GENERIC', label: 'Generic Webhook (Custom HTTP Endpoint)' },
  { value: 'SLACK', label: 'Slack Incoming Webhook' },
  { value: 'TEAMS', label: 'Microsoft Teams Webhook / Connector' },
  { value: 'GOOGLE_CHAT', label: 'Google Chat Webhook' },
  { value: 'DISCORD', label: 'Discord Webhook' },
  { value: 'TELEGRAM', label: 'Telegram Bot' },
];

export default function AddWebhookDialog({ serviceId }: AddWebhookDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        await createWebhookIntegration(serviceId, formData);
        notify.success('Webhook integration added successfully');
        setOpen(false);
      } catch (err: unknown) {
        // In Next.js server actions, redirect() throws an error with digest NEXT_REDIRECT
        // If it's a redirect, let it pass through
        if (
          err &&
          typeof err === 'object' &&
          'digest' in err &&
          typeof (err as { digest: string }).digest === 'string' &&
          (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
        ) {
          setOpen(false);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to create webhook integration');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 px-3 text-xs font-semibold shadow-2xs shrink-0">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Webhook
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
              <Webhook className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-foreground">
                Add Outbound Webhook
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Dispatch real-time incident state notifications to an external HTTP webhook or chat
                tool.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-name" className="text-xs font-semibold">
              Integration Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="webhook-name"
              name="name"
              required
              disabled={isPending}
              placeholder="e.g. Incident Broadcast Slack Channel"
              className="text-xs h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="webhook-type" className="text-xs font-semibold">
              Webhook Platform Type <span className="text-destructive">*</span>
            </Label>
            <select
              id="webhook-type"
              name="type"
              required
              disabled={isPending}
              defaultValue="GENERIC"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {WEBHOOK_TYPES.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              Formats payload structure and headers according to the destination provider.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="webhook-url" className="text-xs font-semibold">
              Webhook URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="webhook-url"
              name="url"
              type="url"
              required
              disabled={isPending}
              placeholder="https://hooks.slack.com/services/... or https://api.corp.internal/..."
              className="text-xs h-9 font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-secret" className="text-xs font-semibold">
                Secret (Optional)
              </Label>
              <Input
                id="webhook-secret"
                name="secret"
                type="password"
                disabled={isPending}
                placeholder="HMAC verification secret"
                className="text-xs h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-channel" className="text-xs font-semibold">
                Channel / Room (Optional)
              </Label>
              <Input
                id="webhook-channel"
                name="channel"
                disabled={isPending}
                placeholder="e.g. #ops-incidents"
                className="text-xs h-9"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending} className="text-xs font-semibold">
              {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create Webhook
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

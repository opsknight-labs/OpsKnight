'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationChannel, NotificationEndpointStatus } from '@prisma/client';
import { resetNotificationEndpoint } from '@/app/(app)/settings/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Button } from '@/components/ui/shadcn/button';
import { notify as toast } from '@/lib/toast';

const CHANNEL_LABELS: ReadonlyMap<NotificationChannel, string> = new Map([
  ['EMAIL', 'Email'],
  ['SMS', 'SMS'],
  ['VOICE', 'Voice'],
  ['WHATSAPP', 'WhatsApp'],
  ['PUSH', 'Push'],
]);

/** Contacts the provider reported as bounced or invalid are skipped until reset here. */
export default function BlockedEndpointsNotice({
  endpoints,
}: {
  endpoints: { channel: NotificationChannel; status: NotificationEndpointStatus }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<NotificationChannel[]>([]);
  const visible = endpoints.filter(endpoint => !hidden.includes(endpoint.channel));
  if (visible.length === 0) return null;

  const reset = (channel: NotificationChannel) =>
    startTransition(async () => {
      const result = await resetNotificationEndpoint(channel);
      if (!result.success) {
        toast.error(result.error || 'Could not reset this contact.');
        return;
      }
      setHidden(current => [...current, channel]);
      toast.success(`${CHANNEL_LABELS.get(channel) ?? channel} will be tried again.`);
      router.refresh();
    });

  return (
    <Alert>
      <AlertTitle>Some contacts are being skipped</AlertTitle>
      <AlertDescription>
        <p className="text-muted-foreground">
          The provider reported these as{' '}
          {visible.some(e => e.status === 'BOUNCED') ? 'bounced or ' : ''}
          invalid, so OpsKnight stopped sending to them. Fix the address if it was wrong, then reset
          the contact to try again.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {visible.map(endpoint => (
            <li key={endpoint.channel} className="flex items-center justify-between gap-3">
              <span>
                {CHANNEL_LABELS.get(endpoint.channel) ?? endpoint.channel}
                <span className="ml-2 text-xs text-muted-foreground">
                  {endpoint.status === 'BOUNCED' ? 'Bounced' : 'Invalid'}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => reset(endpoint.channel)}
              >
                Reset
              </Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

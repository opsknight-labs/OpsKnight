'use client';

import { useState, useTransition } from 'react';
import { notify } from '@/lib/toast';
import { Switch } from '@/components/ui/shadcn/switch';
import { Label } from '@/components/ui/shadcn/label';
import { saveOutboundWebhookSettings } from '@/app/(app)/settings/system/actions';

export default function OutboundWebhookSettings({ allowHttp }: { allowHttp: boolean }) {
  const [checked, setChecked] = useState(allowHttp);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean) => {
    setChecked(next);
    startTransition(async () => {
      try {
        await saveOutboundWebhookSettings({ allowInsecureWebhookUrls: next });
        notify.success(next ? 'Webhooks can now use http:// URLs' : 'Webhooks now require HTTPS');
      } catch {
        setChecked(!next);
        notify.error('Could not save the webhook setting. Try again.');
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="allow-http-webhooks">Allow http:// webhook URLs</Label>
        <p id="allow-http-webhooks-description" className="text-sm text-muted-foreground">
          Off by default: service webhooks must use HTTPS. Turn on only if you post to internal
          tools that don&apos;t support HTTPS. Private and internal network addresses stay blocked
          either way.
        </p>
      </div>
      <Switch
        id="allow-http-webhooks"
        aria-describedby="allow-http-webhooks-description"
        checked={checked}
        disabled={pending}
        onCheckedChange={onChange}
      />
    </div>
  );
}

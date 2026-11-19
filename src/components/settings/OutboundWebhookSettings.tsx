'use client';

import { useState, useTransition } from 'react';
import { useToast } from '@/hooks/use-product-notification';
import { Switch } from '@/components/ui/shadcn/switch';
import { Label } from '@/components/ui/shadcn/label';
import { saveOutboundWebhookSettings } from '@/app/(app)/settings/system/actions';

export default function OutboundWebhookSettings({ allowHttp }: { allowHttp: boolean }) {
  const [checked, setChecked] = useState(allowHttp);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();

  const onChange = (next: boolean) => {
    setChecked(next);
    startTransition(async () => {
      try {
        await saveOutboundWebhookSettings(next);
        showToast(next ? 'Webhooks can now use http:// URLs' : 'Webhooks now require HTTPS', 'success');
      } catch {
        setChecked(!next);
        showToast('Could not save the webhook setting. Try again.', 'error');
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="allow-http-webhooks">Allow http:// webhook URLs</Label>
        <p className="text-sm text-muted-foreground">
          Off by default: service webhooks must use HTTPS. Turn on only if you post to internal
          tools that don&apos;t support HTTPS. Private and internal network addresses stay blocked
          either way.
        </p>
      </div>
      <Switch
        id="allow-http-webhooks"
        checked={checked}
        disabled={pending}
        onCheckedChange={onChange}
      />
    </div>
  );
}

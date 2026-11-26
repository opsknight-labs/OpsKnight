'use client';

import { useEffect, useState, useTransition } from 'react';
import { Switch } from '@/components/ui/shadcn/switch';
import { notify } from '@/lib/toast';
import {
  loadSubscriberChannelsAction,
  saveSubscriberChannelsAction,
  type SubscriberChannelSettings,
} from '@/app/(app)/settings/status-pages/subscriber-channel-actions';

const CHANNELS = [
  { id: 'EMAIL', label: 'Email', hint: 'Verified by a confirmation link.' },
  { id: 'WEBHOOK', label: 'Webhook', hint: 'Signed JSON events; the endpoint echoes a challenge.' },
  { id: 'SLACK', label: 'Slack', hint: 'Incoming-webhook URL, verified by a test message.' },
  {
    id: 'MICROSOFT_TEAMS',
    label: 'Microsoft Teams',
    hint: 'Incoming-webhook or Workflows URL, verified by a test message.',
  },
  {
    id: 'SMS',
    label: 'Text message (SMS)',
    hint: 'Verified by a 6-digit code; uses your SMS provider.',
  },
] as const;

type ChannelId = (typeof CHANNELS)[number]['id'];

/** Per-page switches for the channels visitors may subscribe with. Email and webhook are on by default. */
export default function StatusPageSubscriberChannels({ statusPageId }: { statusPageId: string }) {
  const [settings, setSettings] = useState<SubscriberChannelSettings | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    loadSubscriberChannelsAction(statusPageId)
      .then(result => current && setSettings(result))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [statusPageId]);

  if (!settings) return null;

  const toggle = (id: ChannelId, on: boolean) => {
    const previous = settings.channels;
    const next = on ? [...previous, id] : previous.filter(channel => channel !== id);
    setSettings({ ...settings, channels: next });
    startTransition(async () => {
      const saved = await saveSubscriberChannelsAction({ statusPageId, channels: next });
      if (saved.ok) {
        setSettings(value => (value ? { ...value, channels: saved.channels } : value));
      } else {
        setSettings(value => (value ? { ...value, channels: previous } : value));
        notify.error(saved.error);
      }
    });
  };

  return (
    <fieldset className="space-y-3" aria-busy={pending || undefined}>
      <legend className="text-sm font-semibold text-foreground">Subscriber channels</legend>
      <p className="text-xs text-muted-foreground">
        Channels visitors can pick in the subscribe dialog. Turning one off pauses delivery to its
        subscribers; they are kept.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {CHANNELS.map(channel => {
          const checked = settings.channels.includes(channel.id);
          const unavailable = channel.id === 'SMS' && !settings.smsAvailable;
          return (
            <li key={channel.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{channel.label}</p>
                <p className="text-xs text-muted-foreground">
                  {unavailable
                    ? 'Configure an SMS provider in notification settings first.'
                    : channel.hint}
                </p>
              </div>
              <Switch
                checked={checked}
                disabled={pending || (unavailable && !checked)}
                onCheckedChange={on => toggle(channel.id, on)}
                aria-label={`Allow ${channel.label} subscribers`}
              />
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

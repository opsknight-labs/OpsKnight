'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { Button, FormField, Switch } from '@/components/ui';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { Webhook as WebhookIcon } from 'lucide-react';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastTriggeredAt?: string | null;
  createdAt: string;
}

interface StatusPageWebhooksSettingsProps {
  statusPageId: string;
}

const WEBHOOK_EVENTS = [
  { value: 'incident.created', label: 'Incident Created' },
  { value: 'incident.updated', label: 'Incident Updated' },
  { value: 'incident.resolved', label: 'Incident Resolved' },
  { value: 'status.changed', label: 'Status Changed' },
  { value: 'maintenance.scheduled', label: 'Maintenance Scheduled' },
];

function displayError(error: unknown, fallback: string): string {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description || friendly.title;
}

export default function StatusPageWebhooksSettings({
  statusPageId,
}: StatusPageWebhooksSettingsProps) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    url: '',
    events: [] as string[],
  });

  const loadWebhooks = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(`/api/status-page/webhooks?statusPageId=${statusPageId}`, {
          signal,
        });
        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to load webhooks');
        }
        const data = await response.json();
        setWebhooks(data.webhooks || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(displayError(err, 'Failed to load webhooks'));
      } finally {
        setIsLoading(false);
      }
    },
    [statusPageId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadWebhooks(controller.signal);
    return () => controller.abort();
  }, [loadWebhooks]);

  const handleCreate = () => {
    if (!formData.url || formData.events.length === 0) {
      setError('URL and at least one event are required');
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch('/api/status-page/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            statusPageId,
            url: formData.url,
            events: formData.events,
          }),
        });

        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to create webhook');
        }

        setFormData({ url: '', events: [] });
        setShowForm(false);
        await loadWebhooks();
      } catch (err) {
        setError(displayError(err, 'Failed to create webhook'));
      }
    });
  };

  const handleDelete = (id: string) => {
    if (deleteCandidate !== id) {
      setDeleteCandidate(id);
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/status-page/webhooks?id=${id}&statusPageId=${encodeURIComponent(statusPageId)}`,
          {
            method: 'DELETE',
          }
        );

        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to delete webhook');
        }

        setDeleteCandidate(null);
        await loadWebhooks();
      } catch (err) {
        setError(displayError(err, 'Failed to delete webhook'));
      }
    });
  };

  const toggleEvent = (event: string) => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }));
  };

  if (isLoading) {
    return <div>Loading webhooks...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <StatusPageSectionCard
        title="Webhooks"
        description="Receive real-time notifications when incidents occur or status changes."
        icon={<WebhookIcon className="h-4 w-4" />}
        action={
          <Button variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Add Webhook'}
          </Button>
        }
      >
        <div className="space-y-4">
          {error && (
            <div
              style={{
                padding: 'var(--spacing-3)',
                background: 'var(--color-error-light)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-error-dark)',
                marginBottom: 'var(--spacing-4)',
              }}
            >
              {error}
            </div>
          )}

          {showForm && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-muted/20 p-5 shadow-xs">
              <h3 className="text-base font-semibold text-foreground mb-4">Create Webhook</h3>
              <div className="flex flex-col gap-4">
                <FormField
                  type="input"
                  inputType="url"
                  label="Webhook URL"
                  value={formData.url}
                  onChange={e => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://your-api.com/webhooks/status"
                  required
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Webhooks allow you to receive HTTP POST requests when incidents are created,
                  updated, or resolved. The payload will include the event type and incident
                  details. For security, you can verify the{' '}
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    X-Webhook-Signature
                  </code>{' '}
                  header using your webhook secret.
                </p>
                <div>
                  <label className="block mb-2 text-xs font-semibold text-foreground">
                    Events to Subscribe To
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {WEBHOOK_EVENTS.map(event => (
                      <label
                        key={event.value}
                        className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border/70 bg-card hover:bg-muted/30 cursor-pointer transition-colors text-xs font-medium text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={formData.events.includes(event.value)}
                          onChange={() => toggleEvent(event.value)}
                          className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                        />
                        <span>{event.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="pt-2 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleCreate} isLoading={isPending}>
                    Create Webhook
                  </Button>
                </div>
              </div>
            </div>
          )}

          {webhooks.length === 0 && !showForm && (
            <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-xl">
              <p>No webhooks configured. Click &quot;Add Webhook&quot; to create one.</p>
            </div>
          )}

          {webhooks.length > 0 && (
            <div className="flex flex-col gap-3 mt-4">
              {webhooks.map(webhook => (
                <div
                  key={webhook.id}
                  className="rounded-xl border border-border bg-card p-4 sm:p-5 transition-all shadow-xs hover:border-border/80"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {webhook.url}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Events: {Array.isArray(webhook.events) ? webhook.events.join(', ') : 'None'}
                      </div>
                      {webhook.lastTriggeredAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Last triggered: {new Date(webhook.lastTriggeredAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground font-medium">Enabled</span>
                        <Switch
                          checked={webhook.enabled}
                          onChange={async enabled => {
                            try {
                              const response = await fetch('/api/status-page/webhooks', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  id: webhook.id,
                                  statusPageId,
                                  enabled,
                                }),
                              });
                              if (!response.ok) {
                                throw await errorFromResponse(response, 'Failed to update webhook');
                              }
                              await loadWebhooks();
                            } catch (err) {
                              setError(displayError(err, 'Failed to update webhook'));
                            }
                          }}
                        />
                      </div>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(webhook.id)}
                        isLoading={isPending}
                      >
                        {deleteCandidate === webhook.id ? 'Confirm delete' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </StatusPageSectionCard>
    </div>
  );
}

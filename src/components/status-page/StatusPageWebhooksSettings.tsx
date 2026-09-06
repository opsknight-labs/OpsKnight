'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { Card, Button, FormField, Switch } from '@/components/ui';
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

export default function StatusPageWebhooksSettings({ statusPageId }: StatusPageWebhooksSettingsProps) {
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        url: '',
        events: [] as string[],
    });

    const loadWebhooks = useCallback(async () => {
        try {
            const response = await fetch(`/api/status-page/webhooks?statusPageId=${statusPageId}`);
            if (!response.ok) {
                throw await errorFromResponse(response, 'Failed to load webhooks');
            }
            const data = await response.json();
            setWebhooks(data.webhooks || []);
        } catch (err) {
            setError(displayError(err, 'Failed to load webhooks'));
        } finally {
            setIsLoading(false);
        }
    }, [statusPageId]);

    useEffect(() => {
        loadWebhooks();
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
        // eslint-disable-next-line no-alert
        if (!confirm('Are you sure you want to delete this webhook?')) return;

        startTransition(async () => {
            try {
                const response = await fetch(`/api/status-page/webhooks?id=${id}`, {
                    method: 'DELETE',
                });

                if (!response.ok) {
                    throw await errorFromResponse(response, 'Failed to delete webhook');
                }

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}>
            <Card>
                <div style={{ padding: 'var(--spacing-6)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
                        <div>
                            <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '700', marginBottom: 'var(--spacing-2)' }}>
                                Webhooks
                            </h2>
                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                                Receive real-time notifications when incidents occur or status changes
                            </p>
                        </div>
                        <Button
                            variant="primary"
                            onClick={() => setShowForm(!showForm)}
                        >
                            {showForm ? 'Cancel' : 'Add Webhook'}
                        </Button>
                    </div>

                    {error && (
                        <div style={{ padding: 'var(--spacing-3)', background: 'var(--color-error-light)', borderRadius: 'var(--radius-md)', color: 'var(--color-error-dark)', marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}

                    {showForm && (
                        <Card>
                            <div style={{ padding: 'var(--spacing-4)' }}>
                                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600', marginBottom: 'var(--spacing-4)' }}>
                                    Create Webhook
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
                                    <FormField
                                        type="input"
                                        inputType="url"
                                        label="Webhook URL"
                                        value={formData.url}
                                        onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                        placeholder="https://your-api.com/webhooks/status"
                                        required
                                    />
                                    <p className="text-sm text-gray-500">
                                        Webhooks allow you to receive HTTP POST requests when incidents are created, updated, or resolved. The payload will include the event type and incident details.
                                        For security, you can verify the <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">X-Webhook-Signature</code> header using your webhook secret.
                                    </p>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-sm)', fontWeight: '500' }}>
                                            Events to Subscribe To
                                        </label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                                            {WEBHOOK_EVENTS.map((event) => (
                                                <label
                                                    key={event.value}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        padding: 'var(--spacing-2)',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.events.includes(event.value)}
                                                        onChange={() => toggleEvent(event.value)}
                                                        style={{ marginRight: 'var(--spacing-2)' }}
                                                    />
                                                    <span>{event.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <Button
                                        variant="primary"
                                        onClick={handleCreate}
                                        isLoading={isPending}
                                    >
                                        Create Webhook
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    )}

                    {webhooks.length === 0 && !showForm && (
                        <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <p>No webhooks configured. Click &quot;Add Webhook&quot; to create one.</p>
                        </div>
                    )}

                    {webhooks.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-4)' }}>
                            {webhooks.map((webhook) => (
                                <Card key={webhook.id}>
                                    <div style={{ padding: 'var(--spacing-4)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--spacing-3)' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: '600', marginBottom: 'var(--spacing-1)' }}>
                                                    {webhook.url}
                                                </div>
                                                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                                                    Events: {Array.isArray(webhook.events) ? webhook.events.join(', ') : 'None'}
                                                </div>
                                                {webhook.lastTriggeredAt && (
                                                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--spacing-1)' }}>
                                                        Last triggered: {new Date(webhook.lastTriggeredAt).toLocaleString()}
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                                                    <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                                                        Enabled
                                                    </label>
                                                    <Switch
                                                        checked={webhook.enabled}
                                                        onChange={async (enabled) => {
                                                            try {
                                                                const response = await fetch('/api/status-page/webhooks', {
                                                                    method: 'PATCH',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        id: webhook.id,
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
                                                    Delete
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}

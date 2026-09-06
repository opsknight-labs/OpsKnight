'use client';

import { useState } from 'react';

export default function TestNotificationButton({ incidentId }: { incidentId: string }) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    async function sendTestNotification() {
        setLoading(true);
        setResult(null);
        try {
            const res = await fetch('/api/notifications/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ incidentId })
            });
            const data = await res.json();
            setResult(data.message || 'Notification sent!');
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setResult('Error: ' + e.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ display: 'inline-block' }}>
            <button
                onClick={sendTestNotification}
                disabled={loading}
                className="glass-button"
                style={{ fontSize: '0.85rem' }}
                aria-label={loading ? 'Sending test notification' : 'Send test notification'}
                aria-busy={loading}
            >
                {loading ? 'Sending...' : <><span aria-hidden="true">🔔</span> Test Notify</>}
            </button>
            {result && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {result}
                </span>
            )}
        </div>
    );
}

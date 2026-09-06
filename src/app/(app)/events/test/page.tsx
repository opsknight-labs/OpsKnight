'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SendTestAlertPage() {
  const [_serviceId, _setServiceId] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');
  const [dedupKey, setDedupKey] = useState('test_alert_' + Date.now());
  const [summary, setSummary] = useState('Test Alert from OpsKnight');
  const [severity, setSeverity] = useState<'critical' | 'error' | 'warning' | 'info'>('critical');
  const [eventAction, setEventAction] = useState<'trigger' | 'resolve' | 'acknowledge'>('trigger');
  const [response, setResponse] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendTestAlert() {
    if (!integrationKey) {
      setError('Please enter an Integration Key');
      return;
    }

    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token token=${integrationKey}`,
        },
        body: JSON.stringify({
          event_action: eventAction,
          dedup_key: dedupKey,
          payload: {
            summary,
            source: 'OpsKnight-test-ui',
            severity,
            custom_details: {
              test: true,
              sent_at: new Date().toISOString(),
            },
          },
        }),
      });

      const data = await res.json();
      setResponse({ status: res.status, data });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <Link
        href="/events"
        style={{
          color: 'var(--text-muted)',
          textDecoration: 'none',
          marginBottom: '1rem',
          display: 'block',
        }}
      >
        &larr; Back to Event Logs
      </Link>

      <h1
        style={{
          fontSize: '1.8rem',
          fontWeight: 'bold',
          marginBottom: '0.5rem',
          color: 'var(--text-primary)',
        }}
      >
        Send Test Alert
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
        Test the Anti-Gravity Event Intake API by sending a simulated alert.
      </p>

      <div className="glass-panel" style={{ padding: '2rem', background: 'white' }}>
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {/* Integration Key */}
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
              Integration Key *
            </label>
            <input
              type="text"
              value={integrationKey}
              onChange={e => setIntegrationKey(e.target.value)}
              placeholder="Enter your integration key from a service"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'monospace',
              }}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Get this from: Services → Select Service → Manage Integrations
            </p>
          </div>

          {/* Event Action */}
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
              Event Action
            </label>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {(['trigger', 'acknowledge', 'resolve'] as const).map(action => (
                <label
                  key={action}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    checked={eventAction === action}
                    onChange={() => setEventAction(action)}
                  />
                  <span style={{ textTransform: 'capitalize' }}>{action}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Dedup Key */}
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
              Deduplication Key
            </label>
            <input
              type="text"
              value={dedupKey}
              onChange={e => setDedupKey(e.target.value)}
              placeholder="unique_alert_key"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'monospace',
              }}
            />
          </div>

          {/* Summary */}
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
              Alert Summary
            </label>
            <input
              type="text"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="High CPU on web-server-01"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '4px',
              }}
            />
          </div>

          {/* Severity */}
          <div>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
              Severity
            </label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as any)} // eslint-disable-line @typescript-eslint/no-explicit-any
              style={{
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                minWidth: '200px',
              }}
            >
              <option value="critical">Critical</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>

          {/* Submit */}
          <button
            onClick={sendTestAlert}
            disabled={loading}
            className="glass-button primary"
            style={{ padding: '1rem', fontSize: '1rem' }}
          >
            {loading ? 'Sending...' : 'Send Test Alert'}
          </button>

          {/* Error */}
          {error && (
            <div
              style={{
                padding: '1rem',
                background: '#fce8e8',
                color: 'var(--danger)',
                borderRadius: '4px',
              }}
            >
              {error}
            </div>
          )}

          {/* Response */}
          {response && (
            <div>
              <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem' }}>
                Response
              </label>
              <pre
                style={{
                  background: response.status < 300 ? '#e6f4ea' : '#fce8e8',
                  padding: '1rem',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

'use client';

import { useMemo, useState, useTransition } from 'react';

interface ServiceOption {
  id: string;
  name: string;
}

interface StatusPageSubscribeProps {
  statusPageId: string;
  services?: ServiceOption[];
  variant?: 'card' | 'modal';
  rssHref?: string | null;
  onSuccess?: () => void;
  onClose?: () => void;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const message = (payload as { error?: unknown }).error;
  return typeof message === 'string' && message.trim() ? message : null;
}

export default function StatusPageSubscribe({
  statusPageId,
  services = [],
  variant = 'card',
  rssHref,
  onSuccess,
  onClose,
}: StatusPageSubscribeProps) {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'all' | 'selected'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const hasPicker = services.length > 0;
  const selectedCount = selectedIds.size;
  const allIds = useMemo(() => services.map(s => s.id), [services]);

  const toggleService = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    if (hasPicker && mode === 'selected' && selectedIds.size === 0) {
      setError('Select at least one service to subscribe to');
      return;
    }

    const payload: Record<string, unknown> = {
      statusPageId,
      email: email.trim(),
    };
    if (hasPicker && mode === 'selected') {
      payload.preferences = { selectedServiceIds: [...selectedIds] };
    } else if (hasPicker && mode === 'all') {
      // No preferences = all services (industry default). Omit to keep contract minimal.
    }

    startTransition(async () => {
      try {
        const response = await fetch('/api/status-page/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          let message = 'Failed to subscribe';
          try {
            message = getApiErrorMessage(await response.json()) ?? message;
          } catch {
            // Malformed/non-JSON error responses fall back to generic copy.
          }
          setError(message);
          return;
        }

        setSuccess(true);
        setEmail('');
        if (onSuccess) onSuccess();
      } catch (err: unknown) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setError(getUserFacingErrorMessage(err) || 'Failed to subscribe');
      }
    });
  };

  if (success) {
    return (
      <div className="status-subscribe__success" role="status">
        <strong>✓ Check your email</strong>
        <span>
          We sent a verification link to confirm your subscription. It expires in 24 hours. 1-click
          unsubscribe anytime.
        </span>
        {variant === 'modal' && onClose && (
          <button type="button" className="status-subscribe__success-close" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    );
  }

  const isCard = variant === 'card';

  return (
    <form
      onSubmit={handleSubmit}
      className={isCard ? 'status-subscribe' : 'status-subscribe status-subscribe--modal'}
      aria-labelledby={isCard ? undefined : 'status-subscribe-modal-title'}
    >
      <div className="status-subscribe__copy">
        {isCard ? (
          <>
            <strong>Never miss a service update</strong>
            <span>
              Email alerts for incidents, maintenance, and status changes. Verify to confirm — 1-click
              unsubscribe anytime.
              {rssHref && (
                <>
                  {' '}
                  Prefer <a href={rssHref} className="status-subscribe__rss-link">
                    RSS
                  </a>
                  ?
                </>
              )}
            </span>
          </>
        ) : (
          <>
            <strong id="status-subscribe-modal-title">Subscribe to updates</strong>
            <span>
              Choose the services you care about. We&apos;ll email you only for what matters to you.
            </span>
          </>
        )}
      </div>

      {hasPicker && (
        <fieldset className="status-subscribe__prefs">
          <legend className="sr-only">Notification scope</legend>
          <label className="status-subscribe__radio">
            <input
              type="radio"
              name={`scope-${statusPageId}-${variant}`}
              checked={mode === 'all'}
              onChange={() => setMode('all')}
            />
            <span>
              All services <em className="status-subscribe__radio-hint">Recommended</em>
            </span>
          </label>
          <label className="status-subscribe__radio">
            <input
              type="radio"
              name={`scope-${statusPageId}-${variant}`}
              checked={mode === 'selected'}
              onChange={() => setMode('selected')}
            />
            <span>Only selected services</span>
          </label>

          {mode === 'selected' && (
            <div className="status-subscribe__picker" role="group" aria-label="Select services">
              <div className="status-subscribe__picker-actions">
                <button
                  type="button"
                  className="status-subscribe__picker-btn"
                  onClick={() => setSelectedIds(new Set(allIds))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="status-subscribe__picker-btn"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
                <span className="status-subscribe__picker-count" aria-live="polite">
                  {selectedCount} selected
                </span>
              </div>
              <div className="status-subscribe__picker-grid">
                {services.map(service => (
                  <label key={service.id} className="status-subscribe__check">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(service.id)}
                      onChange={() => toggleService(service.id)}
                    />
                    <span>{service.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      )}

      <div className="status-subscribe__controls">
        <label className="sr-only" htmlFor={`status-subscribe-email-${statusPageId}-${variant}`}>
          Email address
        </label>
        <input
          id={`status-subscribe-email-${statusPageId}-${variant}`}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="status-subscribe__input"
          autoComplete="email"
          required
          aria-describedby={
            hasPicker ? `status-subscribe-hint-${statusPageId}-${variant}` : undefined
          }
        />
        <button type="submit" className="status-subscribe__button" disabled={isPending}>
          {isPending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      {hasPicker && (
        <p id={`status-subscribe-hint-${statusPageId}-${variant}`} className="status-subscribe__hint">
          {mode === 'all'
            ? 'You’ll receive every incident and maintenance update for this status page.'
            : 'You’ll only be notified for the services you selected. Change anytime via unsubscribe → resubscribe.'}
        </p>
      )}
      {!hasPicker && (
        <p className="status-subscribe__hint">
          We&apos;ll send a verification email. 1-click unsubscribe in every update.
        </p>
      )}
      {error && (
        <div className="status-subscribe__error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

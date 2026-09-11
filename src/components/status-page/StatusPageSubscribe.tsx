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

function MailBadgeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2" />
      <path d="M4.2 6.4 12 12.2l7.8-5.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 5 7.2v5.6c0 4 3 6.9 7 8.2 4-1.3 7-4.2 7-8.2V7.2L12 3Z" strokeLinejoin="round" />
      <path d="M9.2 12.2 11 14l3.8-4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ClockVerifyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.8v4.2l2.7 1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function UnsubIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-6 9-6 9h18s-6-2-6-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 21a1.7 1.7 0 0 1-3.4 0" />
      <path d="M4 4 20 20" strokeLinecap="round" />
    </svg>
  );
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
        <span className="status-subscribe__success-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M8.2 12.2 11 15l4.8-5.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <strong>Check your email</strong>
        <span>
          We sent a verification link to confirm your subscription. It expires in 24 hours. Every update
          includes 1-click unsubscribe.
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
      {isCard ? (
        <>
          <div className="status-subscribe__intro">
            <span className="status-subscribe__badge">
              <span className="status-subscribe__badge-dot" aria-hidden="true" />
              Stay informed
              {rssHref ? <span className="status-subscribe__badge-sep">·</span> : null}
              {rssHref ? <a href={rssHref} className="status-subscribe__badge-link">RSS available</a> : null}
            </span>
            <div className="status-subscribe__copy">
              <span className="status-subscribe__icon" aria-hidden="true">
                <MailBadgeIcon />
              </span>
              <div>
                <strong>Never miss a service update</strong>
                <span>Email alerts for incidents and maintenance — only what you choose.</span>
              </div>
            </div>
            <ul className="status-subscribe__trust" aria-label="Trust signals">
              <li>
                <ShieldIcon /> No spam
              </li>
              <li>
                <ClockVerifyIcon /> Verify to confirm
              </li>
              <li>
                <UnsubIcon /> 1-click unsubscribe
              </li>
            </ul>
          </div>

          <div className="status-subscribe__formcol">
            {hasPicker && (
              <div className="status-subscribe__segment" role="group" aria-label="Notification scope">
                <button
                  type="button"
                  className={`status-subscribe__segbtn${mode === 'all' ? ' status-subscribe__segbtn--active' : ''}`}
                  aria-pressed={mode === 'all'}
                  onClick={() => setMode('all')}
                >
                  All services <em>Recommended</em>
                </button>
                <button
                  type="button"
                  className={`status-subscribe__segbtn${mode === 'selected' ? ' status-subscribe__segbtn--active' : ''}`}
                  aria-pressed={mode === 'selected'}
                  onClick={() => setMode('selected')}
                >
                  Selected only
                </button>
              </div>
            )}

            {hasPicker && mode === 'selected' && (
              <div className="status-subscribe__picker" role="group" aria-label="Select services">
                <div className="status-subscribe__picker-actions">
                  <button type="button" className="status-subscribe__picker-btn" onClick={() => setSelectedIds(new Set(allIds))}>
                    Select all
                  </button>
                  <button type="button" className="status-subscribe__picker-btn" onClick={() => setSelectedIds(new Set())}>
                    Clear
                  </button>
                  <span className="status-subscribe__picker-count" aria-live="polite">
                    {selectedCount} selected
                  </span>
                </div>
                <div className="status-subscribe__picker-grid">
                  {services.map(service => (
                    <label key={service.id} className={`status-subscribe__check${selectedIds.has(service.id) ? ' status-subscribe__check--on' : ''}`}>
                      <input type="checkbox" checked={selectedIds.has(service.id)} onChange={() => toggleService(service.id)} />
                      <span>{service.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="status-subscribe__controls">
              <label className="sr-only" htmlFor={`status-subscribe-email-${statusPageId}-${variant}`}>
                Email address
              </label>
              <span className="status-subscribe__inputwrap">
                <span className="status-subscribe__inputicon" aria-hidden="true">
                  <MailBadgeIcon />
                </span>
                <input
                  id={`status-subscribe-email-${statusPageId}-${variant}`}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="status-subscribe__input"
                  autoComplete="email"
                  required
                  aria-describedby={`status-subscribe-hint-${statusPageId}-${variant}`}
                />
              </span>
              <button type="submit" className="status-subscribe__button" disabled={isPending}>
                {isPending ? 'Subscribing…' : 'Subscribe'}
              </button>
            </div>
            <p id={`status-subscribe-hint-${statusPageId}-${variant}`} className="status-subscribe__hint">
              {hasPicker && mode === 'selected'
                ? 'You’ll only be notified for the services you selected. Change anytime via unsubscribe → resubscribe.'
                : 'We’ll send a verification email. 1-click unsubscribe in every update.'}
            </p>
            {error && (
              <div className="status-subscribe__error" role="alert">
                {error}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="status-subscribe__copy status-subscribe__copy--modal">
            <strong id="status-subscribe-modal-title">Subscribe to updates</strong>
            <span>Choose the services you care about. We&apos;ll email you only for what matters to you.</span>
          </div>

          {hasPicker && (
            <div className="status-subscribe__segment" role="group" aria-label="Notification scope">
              <button
                type="button"
                className={`status-subscribe__segbtn${mode === 'all' ? ' status-subscribe__segbtn--active' : ''}`}
                aria-pressed={mode === 'all'}
                onClick={() => setMode('all')}
              >
                All services <em>Recommended</em>
              </button>
              <button
                type="button"
                className={`status-subscribe__segbtn${mode === 'selected' ? ' status-subscribe__segbtn--active' : ''}`}
                aria-pressed={mode === 'selected'}
                onClick={() => setMode('selected')}
              >
                Selected only
              </button>
            </div>
          )}

          {hasPicker && mode === 'selected' && (
            <div className="status-subscribe__picker" role="group" aria-label="Select services">
              <div className="status-subscribe__picker-actions">
                <button type="button" className="status-subscribe__picker-btn" onClick={() => setSelectedIds(new Set(allIds))}>
                  Select all
                </button>
                <button type="button" className="status-subscribe__picker-btn" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </button>
                <span className="status-subscribe__picker-count" aria-live="polite">
                  {selectedCount} selected
                </span>
              </div>
              <div className="status-subscribe__picker-grid">
                {services.map(service => (
                  <label key={service.id} className={`status-subscribe__check${selectedIds.has(service.id) ? ' status-subscribe__check--on' : ''}`}>
                    <input type="checkbox" checked={selectedIds.has(service.id)} onChange={() => toggleService(service.id)} />
                    <span>{service.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="status-subscribe__controls">
            <label className="sr-only" htmlFor={`status-subscribe-email-${statusPageId}-${variant}`}>
              Email address
            </label>
            <span className="status-subscribe__inputwrap">
              <span className="status-subscribe__inputicon" aria-hidden="true">
                <MailBadgeIcon />
              </span>
              <input
                id={`status-subscribe-email-${statusPageId}-${variant}`}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="status-subscribe__input"
                autoComplete="email"
                required
                aria-describedby={`status-subscribe-hint-${statusPageId}-${variant}`}
              />
            </span>
            <button type="submit" className="status-subscribe__button" disabled={isPending}>
              {isPending ? 'Subscribing…' : 'Subscribe'}
            </button>
          </div>
          <p id={`status-subscribe-hint-${statusPageId}-${variant}`} className="status-subscribe__hint">
            {hasPicker && mode === 'selected'
              ? 'You’ll only be notified for the services you selected.'
              : 'We’ll send a verification email. 1-click unsubscribe in every update.'}
          </p>
          {error && (
            <div className="status-subscribe__error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </form>
  );
}

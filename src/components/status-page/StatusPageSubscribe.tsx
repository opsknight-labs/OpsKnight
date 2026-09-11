'use client';

import { useMemo, useState, useTransition } from 'react';

interface ServiceOption {
  id: string;
  name: string;
}

interface StatusPageSubscribeProps {
  statusPageId: string;
  /** Only services with showOnPage:true — already filtered in snapshot.services */
  services?: ServiceOption[];
  variant?: 'card' | 'modal';
  rssHref?: string | null;
  onSuccess?: () => void;
  onClose?: () => void;
}

const MAX_EMAIL_LEN = 254;
function getApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const message = (payload as { error?: unknown }).error;
  return typeof message === 'string' && message.trim() ? message : null;
}

function isValidEmail(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > MAX_EMAIL_LEN) return false;
  // Mirrors API's z.string().trim().email().max(254) intent without pulling zod into the client bundle
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2" />
      <path d="M4.2 6.6 12 12.4l7.8-5.8" strokeLinecap="round" strokeLinejoin="round" />
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

    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError('Please enter a valid email address');
      return;
    }
    if (hasPicker && mode === 'selected' && selectedIds.size === 0) {
      setError('Select at least one service to subscribe to');
      return;
    }

    const payload: Record<string, unknown> = {
      statusPageId,
      email: trimmed,
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
            <circle cx="12" cy="12" r="9.2" />
            <path d="M8.4 12.2 11 14.8l4.6-5.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <strong>Check your email</strong>
        <span>We sent a verification link. It expires in 24 hours. Every update includes 1-click unsubscribe.</span>
        {variant === 'modal' && onClose ? (
          <button type="button" className="status-subscribe__success-close" onClick={onClose}>
            Done
          </button>
        ) : (
          <button type="button" className="status-subscribe__success-close" onClick={() => setSuccess(false)}>
            Dismiss
          </button>
        )}
      </div>
    );
  }

  const isCard = variant === 'card';
  const emailErrorId = `status-subscribe-error-${statusPageId}-${variant}`;
  const hintId = `status-subscribe-hint-${statusPageId}-${variant}`;
  const describedBy = error ? `${hintId} ${emailErrorId}` : hintId;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={isCard ? 'status-subscribe' : 'status-subscribe status-subscribe--modal'}
      aria-labelledby={isCard ? undefined : 'subscribe-modal-heading'}
    >
      {/* Head — same structure in card + modal, only copy differs. Modal outer heading owns the h2. */}
      <div className="status-subscribe__head">
        <span className="status-subscribe__icon" aria-hidden="true">
          <MailIcon />
        </span>
        <div className="status-subscribe__headcopy">
          {isCard ? (
            <>
              <strong>Subscribe to updates</strong>
              <span>Get email alerts for incidents and maintenance — only what you choose.</span>
            </>
          ) : (
            <span>Choose the services you care about. We&apos;ll only email you for what matters.</span>
          )}
        </div>
        {isCard && rssHref && (
          <a href={rssHref} className="status-subscribe__rss">
            RSS
          </a>
        )}
      </div>

      {hasPicker && (
        <div className="status-subscribe__segment" role="group" aria-label="Notification scope">
          <button
            type="button"
            className={`status-subscribe__segbtn${mode === 'all' ? ' status-subscribe__segbtn--active' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            All services
          </button>
          <button
            type="button"
            className={`status-subscribe__segbtn${mode === 'selected' ? ' status-subscribe__segbtn--active' : ''}`}
            aria-pressed={mode === 'selected'}
            onClick={() => setMode('selected')}
          >
            Selected services
          </button>
        </div>
      )}

      {hasPicker && mode === 'selected' && (
        <div className="status-subscribe__picker" role="group" aria-label="Select services">
          <div className="status-subscribe__picker-head">
            <span className="status-subscribe__picker-title">Services on this page</span>
            <span className="status-subscribe__picker-count" aria-live="polite">
              {selectedCount} selected
            </span>
          </div>
          <div className="status-subscribe__picker-actions">
            <button type="button" className="status-subscribe__picker-btn" onClick={() => setSelectedIds(new Set(allIds))}>
              Select all
            </button>
            <button type="button" className="status-subscribe__picker-btn" onClick={() => setSelectedIds(new Set())}>
              Clear
            </button>
          </div>
          <div className="status-subscribe__picker-grid">
            {services.map(service => (
              <label
                key={service.id}
                className={`status-subscribe__check${selectedIds.has(service.id) ? ' status-subscribe__check--on' : ''}`}
              >
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
            <MailIcon />
          </span>
          <input
            id={`status-subscribe-email-${statusPageId}-${variant}`}
            type="email"
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            placeholder="you@company.com"
            className="status-subscribe__input"
            autoComplete="email"
            inputMode="email"
            required
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            maxLength={MAX_EMAIL_LEN}
          />
        </span>
        <button type="submit" className="status-subscribe__button" disabled={isPending}>
          {isPending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>

      <p id={hintId} className="status-subscribe__hint">
        No spam. Verification required. 1-click unsubscribe in every email.
        {!isCard && rssHref ? (
          <>
            {' '}
            <a href={rssHref} className="status-subscribe__hintlink">
              RSS
            </a>{' '}
            available.
          </>
        ) : null}
      </p>

      {error && (
        <div id={emailErrorId} className="status-subscribe__error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

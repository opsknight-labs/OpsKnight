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
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2" />
      <path d="M4.2 6.6 12 12.4l7.8-5.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function CheckListIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M4 11a9 9 0 0 1 9 9" strokeLinecap="round" />
      <path d="M4 4a16 16 0 0 1 16 16" strokeLinecap="round" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      aria-hidden="true"
    >
      <path d="M4 12.5l5.5 5.5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="status-subscribe__spinner"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path
        d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AlertCircleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" strokeLinecap="round" />
      <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}

function SuccessCheckIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M8 12.5l3 3 5.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
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
        <span className="status-subscribe__success-icon">
          <SuccessCheckIcon />
        </span>
        <strong className="status-subscribe__success-title">Check your inbox</strong>
        <p className="status-subscribe__success-msg">
          We sent a verification link to your email. Please click it to confirm and activate your
          updates.
        </p>
        {variant === 'modal' && onClose ? (
          <button type="button" className="status-subscribe__success-close" onClick={onClose}>
            Done
          </button>
        ) : (
          <button
            type="button"
            className="status-subscribe__success-close"
            onClick={() => setSuccess(false)}
          >
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
      {/* Head — rendered only in card view; modal view uses dialog header */}
      {isCard && (
        <div className="status-subscribe__head">
          <span className="status-subscribe__icon" aria-hidden="true">
            <MailIcon />
          </span>
          <div className="status-subscribe__headcopy">
            <strong>Subscribe to Updates</strong>
            <span>
              Receive real-time notifications for active incidents and scheduled maintenance.
            </span>
          </div>
          {rssHref && (
            <a href={rssHref} className="status-subscribe__rss" title="RSS Feed">
              <RssIcon />
              <span>RSS</span>
            </a>
          )}
        </div>
      )}

      {hasPicker && (
        <div className="status-subscribe__segment" role="group" aria-label="Notification scope">
          <button
            type="button"
            className={`status-subscribe__segbtn${mode === 'all' ? ' status-subscribe__segbtn--active' : ''}`}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            <GlobeIcon />
            <span>All services</span>
          </button>
          <button
            type="button"
            className={`status-subscribe__segbtn${mode === 'selected' ? ' status-subscribe__segbtn--active' : ''}`}
            aria-pressed={mode === 'selected'}
            onClick={() => setMode('selected')}
          >
            <CheckListIcon />
            <span>Selected services</span>
          </button>
        </div>
      )}

      {hasPicker && mode === 'selected' && (
        <div className="status-subscribe__picker" role="group" aria-label="Select services">
          <div className="status-subscribe__picker-head">
            <span className="status-subscribe__picker-title">Services on this page</span>
            <div className="status-subscribe__picker-actions">
              <span className="status-subscribe__picker-count" aria-live="polite">
                {selectedCount} of {services.length} selected
              </span>
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
            </div>
          </div>
          <div className="status-subscribe__picker-grid">
            {services.map(service => {
              const isChecked = selectedIds.has(service.id);
              return (
                <label
                  key={service.id}
                  className={`status-subscribe__check${isChecked ? ' status-subscribe__check--on' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleService(service.id)}
                    className="status-subscribe__check-input"
                  />
                  <span className="status-subscribe__check-box" aria-hidden="true">
                    {isChecked && <CheckIcon />}
                  </span>
                  <span className="status-subscribe__check-label">{service.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="status-subscribe__controls">
        <label className="sr-only" htmlFor={`status-subscribe-email-${statusPageId}-${variant}`}>
          Email address
        </label>
        <input
          id={`status-subscribe-email-${statusPageId}-${variant}`}
          type="email"
          value={email}
          onChange={e => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          placeholder="name@company.com"
          className="status-subscribe__input"
          autoComplete="email"
          inputMode="email"
          required
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          maxLength={MAX_EMAIL_LEN}
          disabled={isPending}
        />
        <button type="submit" className="status-subscribe__button" disabled={isPending}>
          {isPending ? (
            <>
              <SpinnerIcon />
              <span>Subscribing…</span>
            </>
          ) : (
            'Subscribe'
          )}
        </button>
      </div>

      <div id={hintId} className="status-subscribe__hint">
        <span className="status-subscribe__hint-icon" aria-hidden="true">
          <ShieldCheckIcon />
        </span>
        <span>No spam. Verification required. 1-click unsubscribe anytime.</span>
        {!isCard && rssHref ? (
          <>
            {' '}
            <a href={rssHref} className="status-subscribe__hintlink">
              RSS Feed
            </a>
          </>
        ) : null}
      </div>

      {error && (
        <div id={emailErrorId} className="status-subscribe__error" role="alert">
          <span className="status-subscribe__error-icon" aria-hidden="true">
            <AlertCircleIcon />
          </span>
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}

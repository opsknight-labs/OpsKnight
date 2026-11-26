'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useT } from '@/lib/status-pages/i18n/context';
import StatusPageWebhookSubscribe from './StatusPageWebhookSubscribe';

interface ServiceOption {
  id: string;
  name: string;
  /** Business services are sent as `selectedBusinessServiceIds`. */
  kind?: 'service' | 'business';
}

interface StatusPageSubscribeProps {
  statusPageId: string;
  /** Only services with showOnPage:true — already filtered in snapshot.services */
  services?: ServiceOption[];
  variant?: 'card' | 'modal';
  rssHref?: string | null;
  apiHref?: string | null;
  onSuccess?: () => void;
  onClose?: () => void;
  /** Opens in 'selected' mode with this service or group already ticked. */
  initialSelectedId?: string | null;
  /** Page slug; when set (and webhook subscriptions are on) a Webhook tab is offered. */
  webhookSlug?: string | null;
  /** Channels the page offers (the public snapshot's `subscription.channels`). */
  channels?: readonly string[] | null;
  /** Slug for the non-email subscribe routes; null when the page has no slug routes. */
  subscribeSlug?: string | null;
}

const MAX_EMAIL_LEN = 254;
const EMAIL_ERROR = 'Please enter a valid email address';
const SERVICES_ERROR = 'Select at least one service to subscribe to';

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

function ApiIcon() {
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
      <path d="M8 8 4 12l4 4M16 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
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

type ServiceScope = ReturnType<typeof useServiceScope>;

/** "All services" or a picked subset; shared by every subscriber channel form. */
function useServiceScope(services: ServiceOption[], initialSelectedId: string | null) {
  const [mode, setMode] = useState<'all' | 'selected'>(initialSelectedId ? 'selected' : 'all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedId ? [initialSelectedId] : [])
  );
  const hasPicker = services.length > 0;
  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /** The API's `preferences`, or undefined when the visitor follows the whole page. */
  const preferences = (timezone?: string) => {
    if (!hasPicker || mode !== 'selected') return undefined;
    const businessIds = new Set(
      services.filter(option => option.kind === 'business').map(option => option.id)
    );
    const picked = [...selectedIds];
    const pickedBusiness = picked.filter(id => businessIds.has(id));
    return {
      selectedServiceIds: picked.filter(id => !businessIds.has(id)),
      ...(pickedBusiness.length ? { selectedBusinessServiceIds: pickedBusiness } : {}),
      ...(timezone ? { timezone } : {}),
    };
  };
  return {
    mode,
    setMode,
    selectedIds,
    setSelectedIds,
    hasPicker,
    toggle,
    missingSelection: hasPicker && mode === 'selected' && selectedIds.size === 0,
    preferences,
  };
}

function ServiceScopePicker({
  services,
  scope,
}: {
  services: ServiceOption[];
  scope: ServiceScope;
}) {
  const allIds = useMemo(() => services.map(s => s.id), [services]);
  return (
    <>
      {scope.hasPicker && (
        <div className="status-subscribe__segment" role="group" aria-label="Notification scope">
          <button
            type="button"
            className={`status-subscribe__segbtn${scope.mode === 'all' ? ' status-subscribe__segbtn--active' : ''}`}
            aria-pressed={scope.mode === 'all'}
            onClick={() => scope.setMode('all')}
          >
            <GlobeIcon />
            <span>All services</span>
          </button>
          <button
            type="button"
            className={`status-subscribe__segbtn${scope.mode === 'selected' ? ' status-subscribe__segbtn--active' : ''}`}
            aria-pressed={scope.mode === 'selected'}
            onClick={() => scope.setMode('selected')}
          >
            <CheckListIcon />
            <span>Selected services</span>
          </button>
        </div>
      )}

      {scope.hasPicker && scope.mode === 'selected' && (
        <div className="status-subscribe__picker" role="group" aria-label="Select services">
          <div className="status-subscribe__picker-head">
            <span className="status-subscribe__picker-title">Services on this page</span>
            <div className="status-subscribe__picker-actions">
              <span className="status-subscribe__picker-count" aria-live="polite">
                {scope.selectedIds.size} of {services.length} selected
              </span>
              <button
                type="button"
                className="status-subscribe__picker-btn"
                onClick={() => {
                  if (allIds.length > 100) {
                    scope.setSelectedIds(new Set(allIds.slice(0, 100)));
                  } else {
                    scope.setSelectedIds(new Set(allIds));
                  }
                }}
                title={allIds.length > 100 ? 'Limited to 100 services per subscription' : undefined}
              >
                Select all{allIds.length > 100 ? ' (100 max)' : ''}
              </button>
              <button
                type="button"
                className="status-subscribe__picker-btn"
                onClick={() => scope.setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="status-subscribe__picker-grid">
            {services.map(service => {
              const isChecked = scope.selectedIds.has(service.id);
              return (
                <label
                  key={service.id}
                  className={`status-subscribe__check${isChecked ? ' status-subscribe__check--on' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => scope.toggle(service.id)}
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
    </>
  );
}

function StatusPageEmailSubscribe({
  statusPageId,
  services = [],
  variant = 'card',
  rssHref,
  apiHref,
  onSuccess,
  onClose,
  initialSelectedId = null,
}: StatusPageSubscribeProps) {
  const [email, setEmail] = useState('');
  const scope = useServiceScope(services, initialSelectedId);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError(EMAIL_ERROR);
      emailRef.current?.focus();
      return;
    }
    if (scope.missingSelection) {
      setError(SERVICES_ERROR);
      return;
    }

    let userTz = 'UTC';
    try {
      userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {}

    const payload: Record<string, unknown> = {
      statusPageId,
      email: trimmed,
      timezone: userTz,
    };
    const preferences = scope.preferences(userTz);
    if (preferences) payload.preferences = preferences;

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
  // The service-picker error is not about the email field, so it must not mark the field invalid.
  const emailInvalid = Boolean(error) && error !== SERVICES_ERROR;
  const emailId = `status-subscribe-email-${statusPageId}-${variant}`;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={isPending || undefined}
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
          {(rssHref || apiHref) && (
            <div className="status-subscribe__feed-links">
              {rssHref && (
                <a href={rssHref} className="status-subscribe__rss" title="RSS Feed">
                  <RssIcon />
                  <span>RSS</span>
                </a>
              )}
              {apiHref && (
                <a href={apiHref} className="status-subscribe__rss" title="JSON API">
                  <ApiIcon />
                  <span>JSON</span>
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <ServiceScopePicker services={services} scope={scope} />

      <label className="status-subscribe__label" htmlFor={emailId}>
        Email address
      </label>
      <div className="status-subscribe__controls">
        <input
          ref={emailRef}
          id={emailId}
          type="email"
          value={email}
          onChange={e => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => {
            // Validate on blur only once something is typed; an empty field is caught on submit.
            if (email.trim() && !isValidEmail(email)) setError(EMAIL_ERROR);
          }}
          placeholder="name@company.com"
          className="status-subscribe__input"
          autoComplete="email"
          inputMode="email"
          required
          aria-invalid={emailInvalid ? 'true' : undefined}
          aria-describedby={describedBy}
          maxLength={MAX_EMAIL_LEN}
          disabled={isPending}
        />
        <button
          type="submit"
          className="status-subscribe__button"
          disabled={isPending}
          aria-busy={isPending || undefined}
        >
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
        {!isCard && (rssHref || apiHref) ? (
          <>
            {' '}
            {rssHref && (
              <a href={rssHref} className="status-subscribe__hintlink">
                RSS Feed
              </a>
            )}
            {rssHref && apiHref && <>{' · '}</>}
            {apiHref && (
              <a href={apiHref} className="status-subscribe__hintlink">
                JSON API
              </a>
            )}
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

async function postJson(
  url: string,
  body: unknown
): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
      data?: Record<string, unknown>;
    } & Record<string, unknown>;
    if (!response.ok) {
      const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      return { ok: false, data: {}, error: message || 'Failed to subscribe' };
    }
    return { ok: true, data: payload.data ?? payload };
  } catch {
    return { ok: false, data: {}, error: 'Failed to subscribe' };
  }
}

function ChannelSuccess({ title, message }: { title: string; message: string }) {
  return (
    <div className="status-subscribe__success" role="status">
      <span className="status-subscribe__success-icon">
        <SuccessCheckIcon />
      </span>
      <strong className="status-subscribe__success-title">{title}</strong>
      <p className="status-subscribe__success-msg">{message}</p>
    </div>
  );
}

const CHAT_COPY = {
  SLACK: {
    label: 'Slack incoming-webhook URL',
    placeholder: 'https://hooks.slack.com/services/…',
    hint: 'We post a test message to the channel before activating it.',
  },
  MICROSOFT_TEAMS: {
    label: 'Microsoft Teams webhook URL',
    placeholder: 'https://….webhook.office.com/… or a Workflows URL',
    hint: 'We post a test message to the channel before activating it.',
  },
} as const;

/** A Slack or Teams channel, by incoming-webhook URL. Active once it accepted a test message. */
function StatusPageChatSubscribe({
  slug,
  channel,
  services = [],
  initialSelectedId = null,
}: {
  slug: string;
  channel: 'SLACK' | 'MICROSOFT_TEAMS';
  services?: ServiceOption[];
  initialSelectedId?: string | null;
}) {
  // eslint-disable-next-line security/detect-object-injection -- channel is a closed union
  const copy = CHAT_COPY[channel];
  const scope = useServiceScope(services, initialSelectedId);
  const [url, setUrl] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { already: boolean }>(null);
  const id = `status-subscribe-${channel.toLowerCase()}-${slug}`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (scope.missingSelection) return setError(SERVICES_ERROR);
    startTransition(async () => {
      const result = await postJson(`/api/status/${encodeURIComponent(slug)}/subscribe/chat`, {
        channel,
        url: url.trim(),
        ...(scope.preferences() ? { preferences: scope.preferences() } : {}),
      });
      if (!result.ok) return setError(result.error ?? 'Failed to subscribe');
      setDone({ already: Boolean(result.data.alreadySubscribed) });
    });
  };

  if (done)
    return (
      <ChannelSuccess
        title="Channel subscribed"
        message={
          done.already
            ? 'This channel is already subscribed.'
            : 'Check the channel for the test message. It has the unsubscribe link.'
        }
      />
    );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending || undefined}
      className="status-subscribe"
    >
      <ServiceScopePicker services={services} scope={scope} />
      <label className="status-subscribe__label" htmlFor={id}>
        {copy.label}
      </label>
      <div className="status-subscribe__controls">
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          maxLength={2048}
          placeholder={copy.placeholder}
          className="status-subscribe__input"
          value={url}
          onChange={event => setUrl(event.target.value)}
          aria-describedby={`${id}-hint`}
          aria-invalid={Boolean(error) || undefined}
          disabled={pending}
        />
        <button
          type="submit"
          className="status-subscribe__button"
          disabled={pending || !url.trim()}
        >
          {pending ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
      <p id={`${id}-hint`} className="status-subscribe__hint">
        {copy.hint}
      </p>
      {error && (
        <div className="status-subscribe__error" role="alert">
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}

/** Text messages: phone number, then the 6-digit code we text to it. */
function StatusPageSmsSubscribe({
  slug,
  services = [],
  initialSelectedId = null,
}: {
  slug: string;
  services?: ServiceOption[];
  initialSelectedId?: string | null;
}) {
  const scope = useServiceScope(services, initialSelectedId);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code' | 'done'>('phone');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const base = `/api/status/${encodeURIComponent(slug)}/subscribe/sms`;
  const id = `status-subscribe-sms-${slug}`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (step === 'phone' && scope.missingSelection) return setError(SERVICES_ERROR);
    startTransition(async () => {
      const result =
        step === 'phone'
          ? await postJson(base, {
              phone: phone.trim(),
              ...(scope.preferences() ? { preferences: scope.preferences() } : {}),
            })
          : await postJson(`${base}/verify`, { phone: phone.trim(), code: code.trim() });
      if (!result.ok) return setError(result.error ?? 'Failed to subscribe');
      setStep(step === 'phone' ? 'code' : 'done');
    });
  };

  if (step === 'done')
    return (
      <ChannelSuccess title="Text updates on" message="Every message has a link to stop them." />
    );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending || undefined}
      className="status-subscribe"
    >
      {step === 'phone' && <ServiceScopePicker services={services} scope={scope} />}
      <label className="status-subscribe__label" htmlFor={`${id}-${step}`}>
        {step === 'phone' ? 'Mobile number' : 'Verification code'}
      </label>
      <div className="status-subscribe__controls">
        {step === 'phone' ? (
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            placeholder="+14155550100"
            className="status-subscribe__input"
            value={phone}
            onChange={event => setPhone(event.target.value)}
            aria-describedby={`${id}-hint`}
            aria-invalid={Boolean(error) || undefined}
            disabled={pending}
          />
        ) : (
          <input
            id={`${id}-code`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            className="status-subscribe__input"
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, ''))}
            aria-describedby={`${id}-hint`}
            aria-invalid={Boolean(error) || undefined}
            disabled={pending}
          />
        )}
        <button
          type="submit"
          className="status-subscribe__button"
          disabled={pending || (step === 'phone' ? !phone.trim() : code.length !== 6)}
        >
          {pending ? 'Sending…' : step === 'phone' ? 'Send code' : 'Verify'}
        </button>
      </div>
      <p id={`${id}-hint`} className="status-subscribe__hint">
        {step === 'phone'
          ? 'Include the country code. We text a 6-digit code to confirm the number.'
          : `Enter the code we texted to ${phone.trim()}. It expires in 10 minutes.`}
      </p>
      {error && (
        <div className="status-subscribe__error" role="alert">
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}

type TabId = 'EMAIL' | 'WEBHOOK' | 'SLACK' | 'MICROSOFT_TEAMS' | 'SMS';
const TAB_LABEL: Record<Exclude<TabId, 'WEBHOOK'>, string> = {
  EMAIL: 'Email',
  SLACK: 'Slack',
  MICROSOFT_TEAMS: 'Teams',
  SMS: 'SMS',
};

/** The channels this page offers (email by default), one tab each when there is more than one. */
export default function StatusPageSubscribe(props: StatusPageSubscribeProps) {
  const t = useT();
  const { webhookSlug, channels, subscribeSlug, ...emailProps } = props;
  const slug = subscribeSlug ?? webhookSlug ?? null;
  // Older callers pass only webhookSlug: email, plus webhook when it is set.
  const offered = (channels ?? (webhookSlug ? ['EMAIL', 'WEBHOOK'] : ['EMAIL'])).filter(
    (channel): channel is TabId => channel in TAB_LABEL || channel === 'WEBHOOK'
  );
  // Everything but email posts to slug routes.
  const tabs = offered.filter(channel => channel === 'EMAIL' || slug);
  const [tab, setTab] = useState<TabId>(tabs[0] ?? 'EMAIL');
  if (tabs.length === 0) return null;
  if (tabs.length === 1 && tabs[0] === 'EMAIL') return <StatusPageEmailSubscribe {...emailProps} />;
  const active = tabs.includes(tab) ? tab : tabs[0];
  const shared = { services: emailProps.services, initialSelectedId: emailProps.initialSelectedId };
  return (
    <div>
      {tabs.length > 1 && (
        <div className="status-subscribe__segment" role="tablist" aria-label="Subscription channel">
          {tabs.map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active === id}
              className={`status-subscribe__segbtn${active === id ? ' status-subscribe__segbtn--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {/* eslint-disable-next-line security/detect-object-injection -- id is a closed TabId */}
              <span>{id === 'WEBHOOK' ? t('subscribe.webhook') : TAB_LABEL[id]}</span>
            </button>
          ))}
        </div>
      )}
      {active === 'EMAIL' ? (
        <StatusPageEmailSubscribe {...emailProps} />
      ) : active === 'WEBHOOK' ? (
        <StatusPageWebhookSubscribe slug={slug!} />
      ) : active === 'SMS' ? (
        <StatusPageSmsSubscribe slug={slug!} {...shared} />
      ) : (
        <StatusPageChatSubscribe slug={slug!} channel={active} {...shared} />
      )}
    </div>
  );
}

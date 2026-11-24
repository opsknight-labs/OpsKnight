'use client';

import { useState } from 'react';
import { useT } from '@/lib/status-pages/i18n/context';

/**
 * Subscribe an HTTPS endpoint. The server proves control with a signed challenge before
 * activating; the signing secret is returned once and must be copied now.
 */
export default function StatusPageWebhookSubscribe({ slug }: { slug: string }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ secret?: string; unsubscribeUrl?: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/status/${encodeURIComponent(slug)}/subscribe/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string | { message?: string };
        data?: { secret?: string; unsubscribeUrl?: string };
        secret?: string;
        unsubscribeUrl?: string;
      };
      if (!response.ok) {
        const message = typeof body.error === 'string' ? body.error : body.error?.message;
        setError(message ?? 'Failed to subscribe');
        return;
      }
      setResult(body.data ?? body);
    } catch {
      setError('Failed to subscribe');
    } finally {
      setPending(false);
    }
  };

  if (result) {
    return (
      <div className="status-subscribe__success" role="status">
        <strong className="status-subscribe__success-title">{t('subscribe.webhook')}</strong>
        {result.secret ? (
          <>
            <p className="status-subscribe__success-msg">Signing secret (shown once):</p>
            <code style={{ wordBreak: 'break-all' }}>{result.secret}</code>
          </>
        ) : (
          <p className="status-subscribe__success-msg">This endpoint is already subscribed.</p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={pending || undefined}
      className="status-subscribe"
    >
      <label htmlFor={`webhook-url-${slug}`}>{t('subscribe.webhookUrl')}</label>
      <input
        id={`webhook-url-${slug}`}
        type="url"
        inputMode="url"
        autoComplete="off"
        maxLength={2048}
        placeholder="https://example.com/hooks/status"
        value={url}
        onChange={event => setUrl(event.target.value)}
        aria-describedby={`webhook-hint-${slug}`}
        aria-invalid={Boolean(error) || undefined}
      />
      <p id={`webhook-hint-${slug}`} className="status-subscribe__hint">
        {t('subscribe.webhookHint')}
      </p>
      {error && (
        <p role="alert" className="status-subscribe__error">
          {error}
        </p>
      )}
      <button type="submit" className="status-subscribe__submit" disabled={pending || !url.trim()}>
        {t('subscribe.webhook')}
      </button>
    </form>
  );
}

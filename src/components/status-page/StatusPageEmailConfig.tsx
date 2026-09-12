'use client';

import { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';
import { Mail, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';

interface EmailProviderConfigProps {
  statusPageId: string;
  currentProvider?: string | null;
}

interface EmailProviderSummary {
  provider: string;
  enabled: boolean;
}

export default function StatusPageEmailConfig({
  statusPageId,
  currentProvider,
}: EmailProviderConfigProps) {
  const [provider, setProvider] = useState<string>(currentProvider || 'auto');
  const [saving, setSaving] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/settings/email-providers')
      .then(res => res.json())
      .then((data: { providers?: EmailProviderSummary[] }) => {
        const emailProviders =
          data.providers
            ?.filter(p => ['resend', 'sendgrid', 'smtp', 'ses'].includes(p.provider) && p.enabled)
            .map(p => p.provider) || [];
        setAvailableProviders(emailProviders);
      })
      .catch(err => {
        if (err instanceof Error) {
          logger.error('Failed to fetch providers', { error: err.message });
        } else {
          logger.error('Failed to fetch providers', { error: String(err) });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/settings/status-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: statusPageId,
          emailProvider: provider === 'auto' ? null : provider,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save email provider');
      }

      setNotice({ kind: 'success', message: 'Email provider settings updated successfully.' });
    } catch (err) {
      setNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save email provider',
      });
    } finally {
      setSaving(false);
    }
  };

  const providerOptions = [
    {
      value: 'auto',
      label: 'Auto (Use System Default)',
      description:
        'Automatically uses the first available email provider configured in system settings.',
    },
    {
      value: 'resend',
      label: 'Resend',
      description: 'Modern developer-first email API with high deliverability rates.',
    },
    {
      value: 'sendgrid',
      label: 'SendGrid',
      description: 'Enterprise email service provider by Twilio.',
    },
    {
      value: 'smtp',
      label: 'Custom SMTP',
      description: 'Direct connection using standard SMTP server credentials.',
    },
    {
      value: 'ses',
      label: 'Amazon SES',
      description: 'Amazon Simple Email Service cloud delivery platform.',
    },
  ];

  return (
    <div className="flex flex-col gap-5 text-foreground">
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-2 p-3 text-xs font-medium rounded-lg border ${
            notice.kind === 'success'
              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
              : 'text-destructive bg-destructive/10 border-destructive/20'
          }`}
        >
          {notice.kind === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <p className="text-xs font-medium">Checking available system email providers...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3">
            {providerOptions.map(option => {
              const isConfigured =
                option.value === 'auto' || availableProviders.includes(option.value);
              const isDisabled = !isConfigured && option.value !== 'auto';
              const isSelected = provider === option.value;

              return (
                <label
                  key={option.value}
                  className={`relative flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                    isDisabled
                      ? 'opacity-50 cursor-not-allowed bg-muted/20 border-border/50'
                      : isSelected
                        ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-xs'
                        : 'border-border/80 bg-card hover:border-border hover:bg-muted/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="emailProvider"
                    value={option.value}
                    checked={isSelected}
                    onChange={e => setProvider(e.target.value)}
                    disabled={isDisabled}
                    className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{option.label}</span>
                      {option.value !== 'auto' && (
                        <div>
                          {isConfigured ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" />
                              Configured in Settings
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted text-muted-foreground border border-border">
                              <AlertCircle className="w-3 h-3 text-muted-foreground" />
                              Not configured
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-end pt-2">
            <Button
              type="button"
              variant="primary"
              isLoading={saving}
              onClick={handleSave}
              leftIcon={<Mail className="w-4 h-4" />}
            >
              Save Email Provider
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

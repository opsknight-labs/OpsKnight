'use client';

import { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';
import { Mail, CheckCircle2, AlertCircle } from 'lucide-react';

interface EmailProviderConfigProps {
  statusPageId: string;
  currentProvider?: string | null;
}

export default function StatusPageEmailConfig({
  statusPageId,
  currentProvider,
}: EmailProviderConfigProps) {
  const [provider, setProvider] = useState<string>(currentProvider || 'auto');
  const [saving, setSaving] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch available email providers
    fetch('/api/settings/email-providers')
      .then(res => res.json())
      .then(data => {
        const emailProviders =
          data.providers
            ?.filter(
              (p: any) => ['resend', 'sendgrid', 'smtp', 'ses'].includes(p.provider) && p.enabled
            ) // eslint-disable-line @typescript-eslint/no-explicit-any
            .map((p: any) => p.provider) || []; // eslint-disable-line @typescript-eslint/no-explicit-any
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
    try {
      const response = await fetch('/api/settings/status-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusPageId,
          emailProvider: provider === 'auto' ? null : provider,
        }),
      });

      if (response.ok) {
        // eslint-disable-next-line no-alert
        alert('Settings saved successfully');
      } else {
        const result = await response.json();
        // eslint-disable-next-line no-alert
        alert('Failed to save settings: ' + result.error);
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Error saving email provider', { error: error.message });
      } else {
        logger.error('Error saving email provider', { error: String(error) });
      }
      // eslint-disable-next-line no-alert
      alert('An error occurred while saving settings');
    } finally {
      setSaving(false);
    }
  };

  const providerOptions = [
    {
      value: 'auto',
      label: 'Auto (Use System Default)',
      description: 'Automatically uses the first available email provider',
    },
    { value: 'resend', label: 'Resend', description: 'Use Resend for subscription emails' },
    { value: 'sendgrid', label: 'SendGrid', description: 'Use SendGrid for subscription emails' },
    { value: 'smtp', label: 'SMTP', description: 'Use SMTP for subscription emails' },
    { value: 'ses', label: 'Amazon SES', description: 'Use Amazon SES for subscription emails' },
  ];

  return (
    <div className="email-provider-config">
      <style jsx>{`
        .email-provider-config {
          background: white;
          border-radius: 8px;
          padding: 24px;
          border: 1px solid #e5e7eb;
        }

        .config-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .config-title {
          font-size: 16px;
          font-weight: 600;
          color: #1f2937;
        }

        .config-description {
          font-size: 14px;
          color: #6b7280;
          margin-bottom: 20px;
        }

        .provider-options {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 20px;
        }

        .provider-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .provider-option:hover {
          border-color: #667eea;
          background: #f9fafb;
        }

        .provider-option.selected {
          border-color: #667eea;
          background: #eef2ff;
        }

        .provider-option.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .provider-option.disabled:hover {
          border-color: #e5e7eb;
          background: white;
        }

        .radio-input {
          margin-top: 4px;
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .provider-info {
          flex: 1;
        }

        .provider-label {
          font-size: 14px;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 4px;
        }

        .provider-description {
          font-size: 13px;
          color: #6b7280;
        }

        .provider-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 4px;
        }

        .provider-status.available {
          background: #d1fae5;
          color: #065f46;
        }

        .provider-status.unavailable {
          background: #fee2e2;
          color: #991b1b;
        }

        .save-button {
          padding: 10px 20px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: background 0.2s;
        }

        .save-button:hover {
          background: #5568d3;
        }

        .save-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .loading {
          padding: 20px;
          text-align: center;
          color: #6b7280;
        }
      `}</style>

      <div className="config-header">
        <Mail size={20} style={{ color: '#667eea' }} />
        <h3 className="config-title">Email Provider for Subscriptions</h3>
      </div>

      <p className="config-description">
        Choose which email provider to use for sending verification and notification emails to
        status page subscribers.
      </p>

      {loading ? (
        <div className="loading">Loading providers...</div>
      ) : (
        <>
          <div className="provider-options">
            {providerOptions.map(option => {
              const isConfigured =
                option.value === 'auto' || availableProviders.includes(option.value);
              const isDisabled = !isConfigured && option.value !== 'auto';

              return (
                <label
                  key={option.value}
                  className={`provider-option ${provider === option.value ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                >
                  <input
                    type="radio"
                    className="radio-input"
                    name="emailProvider"
                    value={option.value}
                    checked={provider === option.value}
                    onChange={e => setProvider(e.target.value)}
                    disabled={isDisabled}
                  />
                  <div className="provider-info">
                    <div className="provider-label">{option.label}</div>
                    <div className="provider-description">{option.description}</div>
                    {option.value !== 'auto' && (
                      <div
                        className={`provider-status ${isConfigured ? 'available' : 'unavailable'}`}
                      >
                        {isConfigured ? (
                          <>
                            <CheckCircle2 size={12} />
                            Configured in System Settings
                          </>
                        ) : (
                          <>
                            <AlertCircle size={12} />
                            Not configured
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <button className="save-button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Email Provider'}
          </button>
        </>
      )}
    </div>
  );
}

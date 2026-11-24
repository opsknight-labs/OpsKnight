'use client';

import { Button, FormField, Switch } from '@/components/ui';
import { formatDateTime } from '@/lib/timezone';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { cn } from '@/lib/utils';
import { RefreshCw, Rss, Key } from 'lucide-react';
import { toneClasses } from '@/components/patterns';
import type React from 'react';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function AdvancedSection({ ctx }: { ctx: StatusPageConfigState }) {
  const {
    formData,
    setFormData,
    apiTokens,
    handleCreateApiToken,
    apiTokenName,
    setApiTokenName,
    apiTokenPending,
    apiTokenError,
    apiTokenValue,
    browserTimeZone,
    handleRevokeApiToken,
    statusPage,
  } = ctx;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-6)',
      }}
    >
      <StatusPageSectionCard
        title="Live Updates & Feeds"
        description="Configure client-side polling intervals and public RSS/JSON feed discovery."
        icon={<RefreshCw className="w-5 h-5 text-primary" />}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-4)',
          }}
        >
          <Switch
            checked={formData.autoRefresh}
            onChange={checked => setFormData({ ...formData, autoRefresh: checked })}
            label="Enable Auto-Refresh"
            helperText="Automatically refresh the status page at regular intervals"
          />
          {formData.autoRefresh && (
            <FormField
              type="input"
              label="Refresh Interval (seconds)"
              value={formData.refreshInterval.toString()}
              onChange={e =>
                setFormData({
                  ...formData,
                  refreshInterval: parseInt(e.target.value) || 60,
                })
              }
              placeholder="60"
              helperText="How often to refresh the page (minimum: 30 seconds)"
            />
          )}
          <div
            style={{
              borderTop: '1px solid hsl(var(--ui-border))',
              paddingTop: 'var(--spacing-3)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-3)',
            }}
          >
            <Switch
              checked={formData.showRssLink}
              onChange={checked => setFormData({ ...formData, showRssLink: checked })}
              label="Show RSS Feed Link"
              helperText="Display link to RSS feed in footer"
            />
            <Switch
              checked={formData.showApiLink}
              onChange={checked => setFormData({ ...formData, showApiLink: checked })}
              label="Show JSON API Link"
              helperText="Display link to JSON API in footer"
            />
          </div>
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Status API Access & Security"
        description="Token authentication and rate limiting for JSON and RSS endpoints."
        icon={<Key className="w-5 h-5 text-primary" />}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-4)',
          }}
        >
          <Switch
            checked={formData.statusApiRequireToken}
            onChange={checked => setFormData({ ...formData, statusApiRequireToken: checked })}
            label="Require API token"
            helperText="Require a token for JSON and RSS endpoints."
          />
          {formData.statusApiRequireToken && apiTokens.length === 0 && (
            <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs">
              Token authentication is enabled. Create at least one API token below so clients can
              access the endpoints.
            </div>
          )}
          <Switch
            checked={formData.statusApiRateLimitEnabled}
            onChange={checked => setFormData({ ...formData, statusApiRateLimitEnabled: checked })}
            label="Enable rate limiting"
            helperText="Throttle API access to protect the status page."
          />
          {formData.statusApiRateLimitEnabled && (
            <div
              style={{
                display: 'grid',
                gap: 'var(--spacing-3)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <FormField
                type="input"
                label="Max requests"
                value={String(formData.statusApiRateLimitMax)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) {
                    setFormData({ ...formData, statusApiRateLimitMax: val });
                  }
                }}
                helperText="Requests per window"
              />
              <FormField
                type="input"
                label="Window (seconds)"
                value={String(formData.statusApiRateLimitWindowSec)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) {
                    setFormData({
                      ...formData,
                      statusApiRateLimitWindowSec: val,
                    });
                  }
                }}
                helperText="Minimum 10 seconds"
              />
            </div>
          )}
          <div
            style={{
              borderTop: '1px solid hsl(var(--ui-border))',
              paddingTop: 'var(--spacing-4)',
            }}
          >
            <h3
              style={{
                fontSize: 'var(--font-size-base)',
                fontWeight: '600',
                marginBottom: 'var(--spacing-3)',
              }}
            >
              API tokens
            </h3>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--spacing-3)',
                alignItems: 'flex-end',
              }}
            >
              <div
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateApiToken(e);
                  }
                }}
              >
                <FormField
                  type="input"
                  label="Token name"
                  required={formData.statusApiRequireToken}
                  value={apiTokenName}
                  onChange={e => setApiTokenName(e.target.value)}
                  placeholder="e.g. External status monitor"
                />
              </div>
              <Button
                type="button"
                variant="primary"
                isLoading={apiTokenPending}
                onClick={handleCreateApiToken}
              >
                Create token
              </Button>
            </div>
            {apiTokenError && (
              <div
                style={{
                  marginTop: 'var(--spacing-2)',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-error-dark)',
                }}
              >
                {apiTokenError}
              </div>
            )}
            {apiTokenValue && (
              <div
                role="status"
                className={cn('mt-3 rounded-md border p-3 text-sm', toneClasses('ok').soft)}
              >
                Copy this token now. You will not be able to view it again.
                <div
                  style={{
                    marginTop: 'var(--spacing-2)',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                  }}
                >
                  {apiTokenValue}
                </div>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--spacing-2)',
                marginTop: 'var(--spacing-4)',
              }}
            >
              {apiTokens.length === 0 ? (
                <p
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--text-muted)',
                  }}
                >
                  No API tokens created yet.
                </p>
              ) : (
                apiTokens.map(token => (
                  <div
                    key={token.id}
                    style={{
                      padding: 'var(--spacing-3)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid hsl(var(--ui-border))',
                      background: 'hsl(var(--ui-muted))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--spacing-3)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '600' }}>{token.name}</div>
                      <div
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Prefix: {token.prefix} · Created{' '}
                        {formatDateTime(token.createdAt, browserTimeZone, {
                          format: 'date',
                        })}
                      </div>
                      {token.lastUsedAt && (
                        <div
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          Last used{' '}
                          {formatDateTime(token.lastUsedAt, browserTimeZone, {
                            format: 'date',
                          })}
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleRevokeApiToken(token.id)}
                      isLoading={apiTokenPending}
                      disabled={Boolean(token.revokedAt)}
                    >
                      {token.revokedAt ? 'Revoked' : 'Revoke'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Uptime Reports & Endpoints"
        description="Public uptime report downloads and external feed endpoints."
        icon={<Rss className="w-5 h-5 text-primary" />}
      >
        <Switch
          checked={formData.enableUptimeExports}
          onChange={checked => setFormData({ ...formData, enableUptimeExports: checked })}
          label="Enable public uptime exports"
          helperText="Allow visitors and admins to download monthly uptime reports (CSV/PDF) directly from the Status Page."
        />
        {formData.enableUptimeExports && (
          <div
            style={{
              marginTop: 'var(--spacing-4)',
              padding: 'var(--spacing-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid hsl(var(--ui-border))',
              background: 'hsl(var(--ui-muted))',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-3)',
            }}
          >
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-muted)',
              }}
            >
              Download the latest uptime export directly from the status API.
            </div>
            <div
              style={{
                display: 'flex',
                gap: 'var(--spacing-2)',
                flexWrap: 'wrap',
              }}
            >
              <a
                href={`/api/status/uptime-export?format=csv&statusPageId=${statusPage.id}`}
                className="glass-button"
                style={{ padding: '0.5rem 1rem', textDecoration: 'none' }}
              >
                Download CSV
              </a>
              <a
                href={`/api/status/uptime-export?format=pdf&statusPageId=${statusPage.id}`}
                className="glass-button"
                style={{ padding: '0.5rem 1rem', textDecoration: 'none' }}
              >
                Download PDF
              </a>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 'var(--spacing-5)',
            borderTop: '1px solid hsl(var(--ui-border))',
            paddingTop: 'var(--spacing-4)',
          }}
        >
          <h4
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: '600',
              marginBottom: 'var(--spacing-3)',
            }}
          >
            API & Feed URLs
          </h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 'var(--spacing-3)',
            }}
          >
            <div
              style={{
                padding: 'var(--spacing-3)',
                background: 'hsl(var(--ui-muted))',
                border: '1px solid hsl(var(--ui-border))',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--spacing-1)',
                }}
              >
                JSON API
              </div>
              <code
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                {typeof window !== 'undefined' ? window.location.origin : ''}
                /api/status
              </code>
            </div>
            <div
              style={{
                padding: 'var(--spacing-3)',
                background: 'hsl(var(--ui-muted))',
                border: '1px solid hsl(var(--ui-border))',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--spacing-1)',
                }}
              >
                RSS Feed
              </div>
              <code
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                {typeof window !== 'undefined' ? window.location.origin : ''}
                /api/status/rss
              </code>
            </div>
          </div>
        </div>
      </StatusPageSectionCard>
    </div>
  );
}

import type { ProviderConfiguration } from '@/lib/auth-control/provider-config';

/** Redacted configuration as delivered to the browser; client secrets are never present. */
export type PublicProviderConfiguration = Omit<ProviderConfiguration, 'clientSecret'> & {
  hasClientSecret: boolean;
};

export type RevisionDifference = { field: string; label: string; from: string; to: string };

const fields: Array<{
  key: keyof PublicProviderConfiguration;
  label: string;
  format?: (value: unknown) => string;
}> = [
  { key: 'providerType', label: 'Provider' },
  { key: 'providerLabel', label: 'Display name' },
  { key: 'issuer', label: 'Issuer' },
  { key: 'clientId', label: 'Client ID' },
  { key: 'organizationId', label: 'Organization' },
  { key: 'tokenEndpointAuthMethod', label: 'Token authentication' },
  { key: 'allowedDomains', label: 'Allowed domains' },
  { key: 'autoProvision', label: 'JIT provisioning', format: value => (value ? 'On' : 'Off') },
  {
    key: 'roleMapping',
    label: 'Role rules',
    format: value =>
      Array.isArray(value)
        ? value
            .map(rule => {
              const r = rule as { claim?: string; value?: string; role?: string };
              return `${r.claim ?? '?'}=${r.value ?? '?'} → ${r.role ?? '?'}`;
            })
            .join('; ') || 'None'
        : 'None',
  },
  { key: 'customScopes', label: 'Extra scopes' },
  {
    key: 'profileMapping',
    label: 'Profile claims',
    format: value =>
      value && typeof value === 'object' && Object.keys(value).length
        ? Object.entries(value as Record<string, string>)
            .map(([field, claim]) => `${field}←${claim}`)
            .join(', ')
        : 'None',
  },
  {
    key: 'sessionMaxAgeSeconds',
    label: 'Maximum session',
    format: value => (value == null ? 'Inherited' : `${Math.round(Number(value) / 3600)} h`),
  },
  {
    key: 'sessionIdleTimeoutSeconds',
    label: 'Idle timeout',
    format: value => (value == null ? 'Inherited' : `${Math.round(Number(value) / 60)} min`),
  },
];

function display(value: unknown, format?: (value: unknown) => string) {
  if (format) return format(value);
  if (value == null || value === '') return 'Not set';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return String(value);
}

/** Field-level differences between two redacted configurations. Secrets are never compared. */
export function revisionDifferences(
  from: PublicProviderConfiguration | null | undefined,
  to: PublicProviderConfiguration
): RevisionDifference[] {
  return fields.flatMap(({ key, label, format }) => {
    // eslint-disable-next-line security/detect-object-injection -- Keys come from the fixed field list above.
    const before = display(from?.[key], format);
    // eslint-disable-next-line security/detect-object-injection -- Keys come from the fixed field list above.
    const after = display(to[key], format);
    return before === after ? [] : [{ field: String(key), label, from: before, to: after }];
  });
}

/** Short operator-facing identifier for an issuer, such as an Entra tenant or Okta domain. */
export function issuerSummary(issuer: string) {
  try {
    const url = new URL(issuer);
    const path = url.pathname.replace(/\/v2\.0$|\/oauth2\/default$/, '').replace(/^\/|\/$/g, '');
    return path ? `${url.host}/${path}` : url.host;
  } catch {
    return issuer;
  }
}

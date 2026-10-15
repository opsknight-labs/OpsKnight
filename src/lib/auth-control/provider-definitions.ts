import type { ProviderConfiguration } from './provider-config';

export type ProviderType = ProviderConfiguration['providerType'];
export const providerDefinitions = {
  azure: {
    label: 'Microsoft Entra ID',
    issuer: '',
    organization: false,
    tenant: true,
    help: 'Use the Directory (tenant) ID from your Entra application overview. Register both redirect URIs as Web callbacks.',
  },
  google: {
    label: 'Google Workspace',
    issuer: 'https://accounts.google.com',
    organization: false,
    tenant: false,
    help: 'Create a Web application OAuth client. Restrict Workspace access with allowed domains in Access & Provisioning.',
  },
  okta: {
    label: 'Okta',
    issuer: '',
    organization: false,
    tenant: false,
    help: 'Use the exact issuer from your Okta authorization server, including /oauth2/default when applicable.',
  },
  auth0: {
    label: 'Auth0',
    issuer: '',
    organization: true,
    tenant: false,
    help: 'Use your Auth0 tenant issuer. An Organization ID is optional and applies only to Auth0.',
  },
  custom: {
    label: 'Custom OIDC / Keycloak',
    issuer: '',
    organization: false,
    tenant: false,
    help: 'Use the exact HTTPS issuer advertised by discovery, including the Keycloak realm path when applicable.',
  },
} as const;

/** Explicitly invoked after confirmation; never changes the active provider. */
export function switchProviderDraft(
  current: ProviderConfiguration,
  providerType: ProviderType
): ProviderConfiguration {
  return {
    ...current,
    enabled: true,
    providerType,
    // eslint-disable-next-line security/detect-object-injection -- Key is a closed, server-defined enum.
    issuer: providerDefinitions[providerType].issuer,
    clientId: '',
    clientSecret: '',
    organizationId: null,
    providerLabel: null,
    customScopes: null,
    profileMapping: {},
    roleMapping: [],
    autoProvision: false,
    tokenEndpointAuthMethod: 'client_secret_basic',
  };
}

export function entraTenant(issuer: string): string {
  return /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0\/?$/.exec(issuer)?.[1] ?? '';
}

export function providerDraftErrors(configuration: ProviderConfiguration, hasSavedSecret: boolean) {
  const errors: Record<string, string> = {};
  if (!configuration.clientId.trim()) errors.clientId = 'Enter the application Client ID.';
  if (!configuration.clientSecret && !hasSavedSecret)
    errors.clientSecret = 'Enter a client secret for this provider and client.';
  try {
    const url = new URL(configuration.issuer);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /[{}]/.test(configuration.issuer)
    )
      throw new Error();
  } catch {
    errors.issuer =
      'Enter the exact HTTPS issuer, without placeholders, query strings or fragments.';
  }
  if (
    configuration.providerType === 'azure' &&
    configuration.issuer.startsWith('https://login.microsoftonline.com/') &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      entraTenant(configuration.issuer)
    )
  ) {
    errors.issuer =
      'Enter the Directory (tenant) ID, or use advanced issuer editing for a supported sovereign-cloud issuer.';
  }
  if (
    configuration.sessionMaxAgeSeconds != null &&
    (configuration.sessionMaxAgeSeconds < 900 || configuration.sessionMaxAgeSeconds > 2592000)
  )
    errors.sessionMaxAgeSeconds = 'Choose a maximum lifetime between 15 minutes and 30 days.';
  if (
    configuration.sessionIdleTimeoutSeconds != null &&
    (configuration.sessionIdleTimeoutSeconds < 300 ||
      configuration.sessionIdleTimeoutSeconds > 604800)
  )
    errors.sessionIdleTimeoutSeconds = 'Choose an idle timeout between 5 minutes and 7 days.';
  if (
    configuration.sessionMaxAgeSeconds != null &&
    configuration.sessionIdleTimeoutSeconds != null &&
    configuration.sessionIdleTimeoutSeconds > configuration.sessionMaxAgeSeconds
  )
    errors.sessionIdleTimeoutSeconds =
      'Idle timeout cannot exceed maximum lifetime. Shorten idle timeout or increase the lifetime.';
  return errors;
}

export function hasBroadAdministratorRule(rules: ProviderConfiguration['roleMapping']) {
  return rules.some(
    rule =>
      rule.role === 'ADMIN' &&
      (!/^(groups?|roles?)$/i.test(rule.claim) ||
        /^(all|everyone|employees|users|members|authenticated|\*)$/i.test(rule.value))
  );
}

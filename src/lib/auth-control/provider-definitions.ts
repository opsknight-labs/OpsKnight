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
    help: 'Create a Web application OAuth client. Restrict sign-in to your Workspace domains in Who can sign in.',
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
    // Group values are provider-specific, and domain trust depends on the provider's proof.
    teamMapping: [],
    domainTrustedLinking: false,
    autoProvision: false,
    tokenEndpointAuthMethod: 'client_secret_basic',
  };
}

/**
 * What to do in each provider's console, in order. Shown next to the callback URLs so an
 * administrator never has to leave the page to find the next step.
 */
export const providerSetupChecklists: Record<ProviderType, string[]> = {
  azure: [
    'Microsoft Entra admin center → App registrations → New registration. Account type: this organizational directory only.',
    'Authentication → Add a platform → Web → paste both callback URLs above.',
    'Certificates & secrets → New client secret → copy the Value (not the Secret ID).',
    'Token configuration → Add optional claim → ID token → email (and xms_edov for automatic account linking).',
    'For roles: App roles → create roles, assign groups in Enterprise applications, and use the "roles" claim. This avoids the 200-group limit.',
    'Copy the Directory (tenant) ID and Application (client) ID from Overview into the fields here.',
  ],
  google: [
    'Google Cloud Console → APIs & Services → OAuth consent screen → Internal.',
    'Credentials → Create credentials → OAuth client ID → Web application.',
    'Authorized redirect URIs → paste both callback URLs above.',
    'Copy the client ID and secret here, and add your Workspace domain in Who can sign in.',
    'Google does not send groups in the ID token; manage roles by hand or with SCIM.',
  ],
  okta: [
    'Okta Admin Console → Applications → Create App Integration → OIDC → Web Application.',
    'Sign-in redirect URIs → paste both callback URLs above. Assign the people or groups who should use OpsKnight.',
    'Security → API → Authorization Servers → default → copy the Issuer URI here (it ends in /oauth2/default).',
    'For roles: in that authorization server, add a "groups" claim (ID token, filter: matches regex .*), and add "groups" to Additional scopes here.',
    'Copy the client ID and secret from the app’s General tab.',
  ],
  auth0: [
    'Auth0 Dashboard → Applications → Create Application → Regular Web Application.',
    'Settings → Allowed Callback URLs → paste both callback URLs above, separated by a comma.',
    'Copy the Domain as the issuer (https://YOUR_TENANT.auth0.com/), and the client ID and secret.',
    'For roles: add a post-login Action that sets a namespaced claim such as https://opsknight/roles, then use that claim in Roles & teams.',
  ],
  custom: [
    'Create a confidential OpenID Connect client (authorization code flow with PKCE).',
    'Add both callback URLs above as valid redirect URIs.',
    'Use the issuer from /.well-known/openid-configuration. For Keycloak: https://HOST/realms/REALM.',
    'OpsKnight must reach the issuer over HTTPS at a public address (private network addresses are refused), and ID tokens must be signed with RS256.',
    'For Keycloak roles: add a "groups" mapper to the client scope, or use realm_access.roles in Roles & teams.',
  ],
};

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

export function hasBroadAdministratorRule(
  rules: Array<Pick<ProviderConfiguration['roleMapping'][number], 'claim' | 'value' | 'role'>>
) {
  return rules.some(rule => {
    // realm_access.roles and resource_access.<client>.roles are group-like claims too.
    const claimName = rule.claim.split('.').pop() ?? rule.claim;
    return (
      rule.role === 'ADMIN' &&
      (!/^(groups?|roles?)$/i.test(claimName) ||
        /^(all|everyone|employees|users|members|authenticated|\*)$/i.test(rule.value.trim()))
    );
  });
}

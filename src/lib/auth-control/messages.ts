// One catalog for every authentication outcome a person can see. It is pure data so the
// login page (client), the administrator test result page and the setup console share
// the same wording, and so docs can be organised by the code shown on screen.

export const IDENTITY_DOCS = 'https://opsknight.com/docs/latest/guides/identity';
export const LOGIN_TROUBLESHOOTING_DOCS =
  'https://opsknight.com/docs/latest/troubleshooting/login/oidc-access/';

export type AuthMessage = {
  title: string;
  detail: string;
  /** What the reader can do next. */
  action: string;
  docsHref?: string;
  /** Shown as a warning (amber) rather than an error (red). */
  tone?: 'error' | 'notice';
};

// End-user sign-in outcomes. Keys are the `error` query values the login page receives.
// They describe only what the identity provider already proved to the person signing in,
// so they never disclose another account's existence or state.
export const SIGN_IN_MESSAGES: Record<string, AuthMessage> = {
  SSO_LINK_NOT_APPROVED: {
    title: 'Your administrator needs to approve your first SSO sign-in',
    detail:
      'An OpsKnight account already uses this email address. For safety, it is connected to single sign-on only after an administrator approves it.',
    action:
      'Your administrators have been notified. Try again after they approve the request, or contact them directly.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_link_not_approved`,
    tone: 'notice',
  },
  SSO_LINK_APPROVAL_EXPIRED: {
    title: 'Your SSO approval has expired',
    detail: 'The approval to connect your account to single sign-on expired before it was used.',
    action:
      'Your administrators have been notified. Ask them to renew the approval, then sign in again.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_link_approval_expired`,
    tone: 'notice',
  },
  SSO_DOMAIN_NOT_ALLOWED: {
    title: 'This email domain is not allowed',
    detail: 'Your identity provider account uses an email domain this workspace does not accept.',
    action: 'Sign in with your work account, or ask an administrator to add your domain.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_domain_not_allowed`,
  },
  SSO_ORGANIZATION_REJECTED: {
    title: 'This organization is not allowed',
    detail: 'Your identity provider account belongs to a different organization or tenant.',
    action: 'Sign in with the account your company gave you for OpsKnight.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_organization_rejected`,
  },
  SSO_AUTO_PROVISION_DISABLED: {
    title: 'You do not have an OpsKnight account yet',
    detail: 'This workspace only lets existing members sign in with single sign-on.',
    action: 'Ask an administrator to invite you, then sign in again.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_auto_provision_disabled`,
  },
  SSO_ROLE_UNMATCHED_DENIED: {
    title: 'Your account is not assigned to OpsKnight',
    detail:
      'You signed in successfully, but none of your groups or roles grant access to this workspace.',
    action: 'Ask your identity administrator to add you to an OpsKnight group.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_role_unmatched_denied`,
  },
  SSO_ACCOUNT_DISABLED: {
    title: 'Your OpsKnight account is disabled',
    detail: 'An administrator or your company directory has deactivated this account.',
    action: 'Contact your administrator if you still need access.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_account_disabled`,
  },
  SSO_EMAIL_REQUIRED: {
    title: 'Your identity provider did not share an email address',
    detail: 'OpsKnight needs your email address to find or create your account.',
    action:
      'Ask your identity administrator to release the email claim to OpsKnight (for Microsoft Entra, add the optional "email" claim).',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_email_required`,
  },
  SSO_EMAIL_UNVERIFIED: {
    title: 'Your email address is not verified',
    detail: 'Your identity provider reports that the email on your account is not verified.',
    action: 'Verify your email with your identity provider, then sign in again.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_email_unverified`,
  },
  SSO_IDENTITY_CONFLICT: {
    title: 'Your sign-in matches more than one account',
    detail: 'OpsKnight could not tell which account this identity belongs to, so it stopped.',
    action: 'Contact your administrator and share the reference below.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_identity_conflict`,
  },
  SSO_SUBJECT_MISSING: {
    title: 'Your identity provider sent an incomplete response',
    detail: 'The response did not include a stable account identifier.',
    action: 'Contact your administrator and share the reference below.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_subject_missing`,
  },
  SSO_NOT_AVAILABLE: {
    title: 'Single sign-on is not available right now',
    detail: 'This workspace does not currently accept single sign-on.',
    action: 'Use another sign-in method, or contact your administrator.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_not_available`,
  },
  SSO_INTERNAL_ERROR: {
    title: 'Something went wrong while signing you in',
    detail: 'OpsKnight could not finish your sign-in. Nothing about your account was changed.',
    action:
      'Try again. If it keeps happening, contact your administrator with the reference below.',
    docsHref: `${LOGIN_TROUBLESHOOTING_DOCS}#sso_internal_error`,
  },
  OIDC_CONFIGURATION_CHANGED: {
    title: 'SSO settings changed while you were signing in',
    detail: 'An administrator updated single sign-on during your sign-in.',
    action: 'Start a new sign-in.',
    tone: 'notice',
  },
  AccountDisabled: {
    title: 'Your OpsKnight account is disabled',
    detail: 'Your password is correct, but this account has been deactivated.',
    action: 'Contact your administrator if you still need access.',
  },
  CredentialsSignin: {
    title: 'Incorrect email or password',
    detail: 'Check your email and password and try again.',
    action: 'If your organization uses single sign-on, use the SSO button instead.',
  },
  SessionExpired: {
    title: 'Your session has expired',
    detail: 'You were signed out for your security.',
    action: 'Sign in again to continue.',
    tone: 'notice',
  },
  OAuthSignin: {
    title: 'Could not reach your identity provider',
    detail: 'OpsKnight could not start single sign-on.',
    action: 'Try again. If it keeps happening, contact your administrator.',
  },
  OAuthCallback: {
    title: 'Your identity provider returned an error',
    detail: 'The sign-in was cancelled or the identity provider rejected it.',
    action: 'Try again. If it keeps happening, contact your administrator.',
  },
  Configuration: {
    title: 'Sign-in is misconfigured',
    detail: 'OpsKnight has a server configuration problem.',
    action: 'Contact your administrator.',
  },
  AccessDenied: {
    title: 'Access denied',
    detail: 'Your sign-in was not accepted.',
    action: 'Contact your administrator.',
  },
};

// Why an existing session ended. Keys are the allow-listed `reason` values that middleware
// forwards to the login page.
export const SESSION_END_MESSAGES: Record<string, AuthMessage> = {
  SESSION_REVOKED_BY_POLICY: {
    title: 'Your organization changed how you sign in',
    detail: 'Your administrator changed the sign-in policy, which ended earlier sessions.',
    action: 'Sign in again using the option shown below.',
    tone: 'notice',
  },
  AUTHENTICATION_POLICY_DENIED: {
    title: 'Your organization changed how you sign in',
    detail: 'This sign-in method is no longer allowed for your session.',
    action: 'Sign in again using the option shown below.',
    tone: 'notice',
  },
  OIDC_SESSION_IDLE_TIMEOUT: {
    title: 'You were signed out after a period of inactivity',
    detail: 'Your organization signs people out when they have been idle for a while.',
    action: 'Sign in again to continue.',
    tone: 'notice',
  },
  OIDC_SESSION_RENEWAL_REQUIRED: {
    title: 'Please confirm your sign-in',
    detail: 'Your organization asks you to sign in with your identity provider periodically.',
    action: 'Sign in again to continue.',
    tone: 'notice',
  },
  OIDC_CONFIGURATION_CHANGED: {
    title: 'Single sign-on settings were updated',
    detail: 'An administrator updated single sign-on, which signs everyone in again.',
    action: 'Sign in again to continue.',
    tone: 'notice',
  },
  SESSION_EXPIRED: {
    title: 'Your session has expired',
    detail: 'You were signed out for your security.',
    action: 'Sign in again to continue.',
    tone: 'notice',
  },
  SESSION_REVOKED: {
    title: 'You were signed out',
    detail: 'Your session ended because your account or access changed.',
    action: 'Sign in again to continue.',
    tone: 'notice',
  },
  USER_DISABLED: {
    title: 'Your OpsKnight account is disabled',
    detail: 'An administrator or your company directory has deactivated this account.',
    action: 'Contact your administrator if you still need access.',
  },
};

const OIDC_FAILURE_TO_SIGN_IN_CODE: Record<string, keyof typeof SIGN_IN_MESSAGES> = {
  OIDC_LINK_NOT_APPROVED: 'SSO_LINK_NOT_APPROVED',
  OIDC_LINK_APPROVAL_EXPIRED: 'SSO_LINK_APPROVAL_EXPIRED',
  OIDC_DOMAIN_NOT_ALLOWED: 'SSO_DOMAIN_NOT_ALLOWED',
  OIDC_ORGANIZATION_REJECTED: 'SSO_ORGANIZATION_REJECTED',
  OIDC_AUTO_PROVISION_DISABLED: 'SSO_AUTO_PROVISION_DISABLED',
  OIDC_TARGET_NOT_OPERATIONAL: 'SSO_ACCOUNT_DISABLED',
  OIDC_EMAIL_REQUIRED: 'SSO_EMAIL_REQUIRED',
  OIDC_EMAIL_ASSURANCE_REQUIRED: 'SSO_EMAIL_UNVERIFIED',
  OIDC_AMBIGUOUS_IDENTITY_CONFLICT: 'SSO_IDENTITY_CONFLICT',
  OIDC_ROLE_UNMATCHED_DENIED: 'SSO_ROLE_UNMATCHED_DENIED',
};

/** Maps an internal OIDC rejection reason to the code shown on the login page. */
const failureCodes = new Map(Object.entries(OIDC_FAILURE_TO_SIGN_IN_CODE));
const signInMessages = new Map(Object.entries(SIGN_IN_MESSAGES));
const sessionEndMessages = new Map(Object.entries(SESSION_END_MESSAGES));

export function signInCodeForOidcFailure(reason: string): string {
  return failureCodes.get(reason) ?? 'SSO_INTERNAL_ERROR';
}

export function signInMessage(code: string | null | undefined): AuthMessage | null {
  if (!code || code === 'SessionRequired') return null;
  return (
    signInMessages.get(code) ?? {
      title: 'Couldn’t sign you in',
      detail: 'Your sign-in did not complete.',
      action: 'Try again. If it keeps happening, contact your administrator.',
    }
  );
}

/** Approval messages promise a notification only when one was actually sent. */
export function signInMessageFor(
  code: string | null | undefined,
  options: { administratorsNotified?: boolean } = {}
): AuthMessage | null {
  const message = signInMessage(code);
  if (
    message &&
    !options.administratorsNotified &&
    (code === 'SSO_LINK_NOT_APPROVED' || code === 'SSO_LINK_APPROVAL_EXPIRED')
  )
    return {
      ...message,
      action: 'Ask an administrator to approve your SSO access, then sign in again.',
    };
  return message;
}

export function sessionEndMessage(reason: string | null | undefined): AuthMessage | null {
  if (!reason) return null;
  return sessionEndMessages.get(reason) ?? null;
}

/** Reference IDs are short, unguessable-enough strings that tie a screen to a log entry. */
export const SIGN_IN_REFERENCE_PATTERN = /^[A-Za-z0-9]{6,16}$/;

export const ADMIN_TEST_DOCS =
  'https://opsknight.com/docs/latest/troubleshooting/login/admin-test-failures/';

export type AdminTestFailureCode =
  | 'ORIGIN_CHANGED'
  | 'ORGANIZATION_REJECTED'
  | 'DOMAIN_NOT_ALLOWED'
  | 'EMAIL_UNVERIFIED'
  | 'EMAIL_MISSING'
  | 'EMAIL_MISMATCH'
  | 'SUBJECT_MISSING'
  | 'GROUP_CLAIMS_INCOMPLETE'
  | 'CONFIG_CHANGED'
  | 'ADMIN_STATE_CHANGED'
  | 'IDENTITY_OWNED_BY_OTHER_USER'
  | 'LINK_NOT_ALLOWED'
  | 'ROLE_WOULD_DROP_ADMIN'
  | 'PROVIDER_ACCESS_DENIED'
  | 'PROVIDER_INVALID_SCOPE'
  | 'PROVIDER_CLIENT_REJECTED'
  | 'PROVIDER_ERROR'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'FLOW_EXPIRED'
  | 'REVISION_DELETED'
  | 'UNKNOWN';

export type AuthSetupStep = 'connection' | 'access' | 'roles' | 'policy' | 'emergency';

export type AdminTestMessage = AuthMessage & {
  /** Where in the setup console the administrator fixes this. */
  fix: { step: AuthSetupStep; label: string };
};

export const ADMIN_TEST_MESSAGES: Record<AdminTestFailureCode, AdminTestMessage> = {
  ORIGIN_CHANGED: {
    title: 'The OpsKnight address changed during the test',
    detail: 'The test started on one application URL and finished on another.',
    action: 'Make sure everyone uses the same canonical URL, then run the test again.',
    fix: { step: 'connection', label: 'Review the application URL' },
  },
  ORGANIZATION_REJECTED: {
    title: 'Your identity provider account is outside the allowed organization',
    detail: 'The organization ID in your sign-in does not match the one configured for OpsKnight.',
    action:
      'Sign in with an account from the configured organization, or correct the organization ID.',
    fix: { step: 'connection', label: 'Check the organization ID' },
  },
  DOMAIN_NOT_ALLOWED: {
    title: 'Your email domain is not in the allowed domains',
    detail: 'OpsKnight checked your sign-in against the allowed domains list and it did not match.',
    action: 'Add your domain to the allowed domains, or test with an account in an allowed domain.',
    fix: { step: 'access', label: 'Edit allowed domains' },
  },
  EMAIL_UNVERIFIED: {
    title: 'Your identity provider says your email is not verified',
    detail:
      'Allowed domains and account linking rely on a verified email, and this sign-in reported email_verified=false or did not send it.',
    action:
      'Verify the email in your identity provider, or ask it to release the email_verified claim.',
    fix: { step: 'connection', label: 'Review provider claims' },
  },
  EMAIL_MISSING: {
    title: 'Your identity provider did not send an email address',
    detail:
      'OpsKnight needs the email claim to link the test sign-in to your administrator account.',
    action:
      'Release the email claim to OpsKnight. For Microsoft Entra, add the optional "email" claim to the ID token in Token configuration.',
    fix: { step: 'connection', label: 'Review provider claims' },
  },
  EMAIL_MISMATCH: {
    title: 'The email from your identity provider does not match your OpsKnight account',
    detail:
      'The first SSO sign-in links to your administrator account only when the verified email is identical.',
    action:
      'Sign in at the identity provider with the same email as your OpsKnight account, or change your OpsKnight email in Profile first.',
    fix: { step: 'policy', label: 'Back to the test' },
  },
  SUBJECT_MISSING: {
    title: 'The sign-in did not include a stable account identifier',
    detail: 'Every OpenID Connect sign-in must include a "sub" claim.',
    action: 'Check the provider application type is OpenID Connect, not plain OAuth.',
    fix: { step: 'connection', label: 'Review provider settings' },
  },
  GROUP_CLAIMS_INCOMPLETE: {
    title: 'Your group claims were incomplete',
    detail:
      'A role rule uses a claim that was missing from your sign-in, or your provider sent a "too many groups" marker instead of the list.',
    action:
      'Make the provider send the claim used by your role rules. For Microsoft Entra with many groups, use App roles (the "roles" claim) or emit only groups assigned to the application.',
    fix: { step: 'roles', label: 'Review role rules' },
  },
  CONFIG_CHANGED: {
    title: 'Single sign-on settings changed during the test',
    detail: 'Another administrator activated a configuration while you were signing in.',
    action: 'Reload the console and run the test again.',
    tone: 'notice',
    fix: { step: 'policy', label: 'Run the test again' },
  },
  ADMIN_STATE_CHANGED: {
    title: 'Your administrator account changed during the test',
    detail: 'Your role, status or sessions changed between starting and finishing the test.',
    action: 'Sign in again and run the test again.',
    tone: 'notice',
    fix: { step: 'policy', label: 'Run the test again' },
  },
  IDENTITY_OWNED_BY_OTHER_USER: {
    title: 'This identity is already linked to another OpsKnight user',
    detail: 'The account you used at the identity provider belongs to someone else in OpsKnight.',
    action:
      'Sign in at the identity provider as yourself (try a private window), then run the test again.',
    fix: { step: 'policy', label: 'Run the test again' },
  },
  LINK_NOT_ALLOWED: {
    title: 'Linking was not allowed for this test',
    detail:
      'This is your first SSO sign-in, so OpsKnight needs your permission to link it to your account.',
    action: 'Tick “Allow this SSO identity to link…” and run the test again.',
    fix: { step: 'policy', label: 'Allow linking and retest' },
  },
  ROLE_WOULD_DROP_ADMIN: {
    title: 'These role rules would remove your administrator access',
    detail:
      'After applying the role rules to your sign-in, your role would no longer be Administrator, so activation would lock you out.',
    action:
      'Add a rule that grants Administrator to a group you belong to (see the claims below), or change the default role.',
    fix: { step: 'roles', label: 'Fix role rules' },
  },
  PROVIDER_ACCESS_DENIED: {
    title: 'Your identity provider refused the sign-in',
    detail:
      'Either the sign-in was cancelled, or your account is not assigned to the OpsKnight application at the identity provider.',
    action:
      'Assign yourself (or your group) to the OpsKnight application, then run the test again.',
    fix: { step: 'policy', label: 'Run the test again' },
  },
  PROVIDER_INVALID_SCOPE: {
    title: 'Your identity provider rejected the requested scopes',
    detail: 'One of the additional scopes is not allowed for this application.',
    action: 'Remove or correct the additional scopes.',
    fix: { step: 'connection', label: 'Edit additional scopes' },
  },
  PROVIDER_CLIENT_REJECTED: {
    title: 'Your identity provider rejected the client credentials',
    detail:
      'The client ID, client secret or token authentication method does not match the provider.',
    action:
      'Copy the client ID and a fresh secret from the provider, and choose the token authentication method it advertises.',
    fix: { step: 'connection', label: 'Edit client credentials' },
  },
  PROVIDER_ERROR: {
    title: 'Your identity provider returned an error',
    detail: 'The provider ended the sign-in with an error.',
    action: 'Read the provider message below, fix it in the provider, then run the test again.',
    fix: { step: 'connection', label: 'Review provider settings' },
  },
  TOKEN_EXCHANGE_FAILED: {
    title: 'OpsKnight could not complete the sign-in with your provider',
    detail:
      'The authorization code could not be exchanged or the ID token failed validation (signature, nonce, audience or clock).',
    action:
      'Check the client secret and token authentication method, both callback URLs, and that the server clock is correct.',
    fix: { step: 'connection', label: 'Edit client credentials' },
  },
  FLOW_EXPIRED: {
    title: 'The test took too long or was opened in another browser',
    detail: 'A test must finish in the same browser within a few minutes.',
    action: 'Run the test again and complete the provider sign-in promptly.',
    tone: 'notice',
    fix: { step: 'policy', label: 'Run the test again' },
  },
  REVISION_DELETED: {
    title: 'The configuration under test was deleted',
    detail: 'It was removed before the sign-in completed.',
    action: 'Save your configuration again and run a new test.',
    tone: 'notice',
    fix: { step: 'connection', label: 'Back to the provider' },
  },
  UNKNOWN: {
    title: 'The administrator test failed',
    detail: 'OpsKnight could not verify administrator access with this configuration.',
    action: 'Check the diagnostics below and the server log, then run the test again.',
    fix: { step: 'connection', label: 'Back to the provider' },
  },
};

const adminTestMessages = new Map(Object.entries(ADMIN_TEST_MESSAGES));

export function adminTestMessage(code: string | null | undefined): AdminTestMessage {
  return adminTestMessages.get(code ?? '') ?? ADMIN_TEST_MESSAGES.UNKNOWN;
}

export function isAdminTestFailureCode(code: unknown): code is AdminTestFailureCode {
  return typeof code === 'string' && adminTestMessages.has(code);
}

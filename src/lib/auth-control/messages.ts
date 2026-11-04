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

export function sessionEndMessage(reason: string | null | undefined): AuthMessage | null {
  if (!reason) return null;
  return sessionEndMessages.get(reason) ?? null;
}

/** Reference IDs are short, unguessable-enough strings that tie a screen to a log entry. */
export const SIGN_IN_REFERENCE_PATTERN = /^[A-Za-z0-9]{6,16}$/;

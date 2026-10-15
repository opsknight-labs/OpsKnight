import {
  EmailContainer,
  EmailHeader,
  EmailContent,
  EmailButton,
  EmailFooter,
  InfoCard,
  StatusBadge,
  AlertBox,
  escapeHtml,
} from './email-components';

type Tone = 'info' | 'success' | 'warning' | 'error';
type Presentation = { title: string; tone: Tone; label: string; guidance: string };
const presentations: Record<string, Presentation> = {
  'auth.oidc.revision.staged': {
    title: 'SSO configuration staged',
    tone: 'info',
    label: 'Awaiting verification',
    guidance:
      'Review the staged configuration and complete a real administrator sign-in before activation. Active sign-in settings have not changed.',
  },
  'auth.oidc.test.success': {
    title: 'Administrator SSO sign-in verified',
    tone: 'success',
    label: 'Verification recorded',
    guidance:
      'Review the verification evidence and enforcement impact before activating this configuration.',
  },
  'auth.oidc.test.failed': {
    title: 'Administrator SSO verification failed',
    tone: 'warning',
    label: 'Review required',
    guidance:
      'Review the recorded test failure and provider configuration before testing again. Discovery success alone does not verify administrator access.',
  },
  'auth.policy.changed': {
    title: 'Authentication policy changed',
    tone: 'warning',
    label: 'Configuration changed',
    guidance:
      'Confirm this policy change was authorized. Review the active sign-in mode, provider configuration and affected sessions.',
  },
  'auth.emergency.login.success': {
    title: 'Emergency access used',
    tone: 'error',
    label: 'Security review',
    guidance:
      'Confirm this emergency sign-in was authorized. Review recovery activity and revoke affected sessions if the use was unexpected.',
  },
  'auth.emergency.login.failed': {
    title: 'Emergency sign-in failed',
    tone: 'warning',
    label: 'Sign-in rejected',
    guidance:
      'Review emergency sign-in evidence. Repeated failures may need investigation; a rejected attempt does not establish account compromise.',
  },
  'auth.emergency.requests.throttled': {
    title: 'Emergency sign-in requests limited',
    tone: 'warning',
    label: 'Rate limit applied',
    guidance:
      'Review request patterns and recovery availability. Coordinate with the deployment administrator if legitimate custodians cannot sign in.',
  },
  'auth.emergency.recovery.degraded': {
    title: 'Emergency recovery readiness reduced',
    tone: 'error',
    label: 'Recovery needs attention',
    guidance:
      'Review verified recovery identities and restore the required recovery coverage. Keep an independent recovery path available while making changes.',
  },
  'auth.recovery.password.restored': {
    title: 'Password recovery access restored',
    tone: 'error',
    label: 'Recovery action',
    guidance:
      'Confirm the recovery action and its scope were authorized. Review affected identities and restore the intended sign-in policy after recovery.',
  },
  'auth.recovery.origin.repaired': {
    title: 'Authentication recovery URL repaired',
    tone: 'warning',
    label: 'Deployment changed',
    guidance:
      'Confirm the canonical authentication URL and reconcile deployment settings across web replicas.',
  },
  'auth.emergency.enrolled': {
    title: 'Emergency identity created',
    tone: 'warning',
    label: 'Recovery changed',
    guidance:
      'Verify the new recovery identity and confirm its credential is stored independently of the identity provider.',
  },
  'auth.emergency.credential.enrolled': {
    title: 'Recovery security key enrolled',
    tone: 'warning',
    label: 'Credential added',
    guidance:
      'Confirm the enrolled key belongs to the intended custodian and verify recovery readiness.',
  },
  'auth.emergency.credential.enrollment.failed': {
    title: 'Recovery key enrollment failed',
    tone: 'warning',
    label: 'Enrollment rejected',
    guidance:
      'Review the enrollment evidence and retry from the recovery workspace with the intended security key.',
  },
  'auth.emergency.credential.revoked': {
    title: 'Recovery security key revoked',
    tone: 'warning',
    label: 'Credential revoked',
    guidance:
      'Confirm the revocation was authorized and check remaining verified recovery coverage.',
  },
  'auth.emergency.disabled': {
    title: 'Emergency identity disabled',
    tone: 'warning',
    label: 'Recovery changed',
    guidance:
      'Confirm the identity was intentionally disabled and review remaining verified custodians.',
  },
  'auth.emergency.legacy.retired': {
    title: 'Legacy emergency access retired',
    tone: 'warning',
    label: 'Recovery changed',
    guidance:
      'Confirm the replacement recovery identities have been verified and their credentials are independently accessible.',
  },
  'auth.emergency.method.changed': {
    title: 'Recovery authentication method changed',
    tone: 'warning',
    label: 'Credential changed',
    guidance:
      'Confirm the new authentication method and independently store the replacement credential. Review revoked recovery sessions.',
  },
  'auth.emergency.password.rotated': {
    title: 'Emergency password rotated',
    tone: 'warning',
    label: 'Credential rotated',
    guidance:
      'Confirm the rotation was authorized and the replacement password has been stored in the independent vault. This email does not contain the password.',
  },
  'auth.emergency.reauthenticated': {
    title: 'Emergency identity reauthenticated',
    tone: 'info',
    label: 'Identity verified',
    guidance:
      'Review this verification if you did not expect a custodian to perform a sensitive authentication action.',
  },
  'auth.emergency.session.revoked': {
    title: 'Emergency session revoked',
    tone: 'info',
    label: 'Session revoked',
    guidance:
      'Confirm the session revocation was expected. The custodian must sign in again to regain access.',
  },
  'auth.session.revoked': {
    title: 'Authentication session revoked',
    tone: 'info',
    label: 'Session revoked',
    guidance: 'Review the recorded session action if the revocation was unexpected.',
  },
  'auth.alert.delivery.retry': {
    title: 'Security notification retry requested',
    tone: 'info',
    label: 'Delivery retry',
    guidance:
      'Review the notification delivery timeline. A retry can produce a duplicate email when the earlier delivery result was uncertain.',
  },
  'auth.user.sso.invited': {
    title: 'SSO user invitation created',
    tone: 'info',
    label: 'Access invitation',
    guidance:
      'Confirm the invited identity and assigned access in the user directory. The user must complete a verified provider sign-in before the first-link approval expires.',
  },
};
const colors = {
  info: { accent: '#2563eb', gradient: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' },
  success: { accent: '#059669', gradient: 'linear-gradient(135deg, #064e3b 0%, #059669 100%)' },
  warning: { accent: '#d97706', gradient: 'linear-gradient(135deg, #78350f 0%, #d97706 100%)' },
  error: { accent: '#be123c', gradient: 'linear-gradient(135deg, #881337 0%, #be123c 100%)' },
};

/** Uses the already-authoritative origin, never a URL from event context. */
export function authenticationEmailUrls(origin: string) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password)
    throw new Error('Canonical authentication origin unavailable.');
  return {
    instance: base.origin,
    logo: new URL('/logo.png', base).href,
    review: new URL('/settings/system?section=sso&authTab=diagnostics&authView=audit', base).href,
    login: new URL('/login', base).href,
  };
}

export function getAuthenticationSecurityEmailTemplate(data: {
  title: string;
  message: string;
  eventId: string;
  createdAt: Date;
  origin: string;
  event?: { eventType: string; outcome: string; createdAt: Date };
}) {
  const urls = authenticationEmailUrls(data.origin);
  // No arbitrary context, claims, passwords, tokens or provider responses are accepted.
  const recorded = data.event;
  const known =
    recorded && Object.entries(presentations).find(([key]) => key === recorded.eventType)?.[1];
  const presentation: Presentation =
    data.title === 'Emergency sign-in failures detected'
      ? {
          title: data.title,
          tone: 'warning',
          label: 'Failures detected',
          guidance:
            'Review the aggregated failures and individual evidence in Diagnostics. Check recovery availability before changing credentials or deployment limits.',
        }
      : (known ?? {
          title: 'Authentication security event',
          tone: recorded && recorded.outcome !== 'success' ? 'warning' : 'info',
          label: 'Security notification',
          guidance:
            'Review the recorded authentication event and confirm the activity was authorized. If it was unexpected, contact your deployment administrator using an independent channel.',
        });
  const color = colors[presentation.tone];
  const when = (recorded?.createdAt ?? data.createdAt).toISOString();
  const items = [
    { label: 'Instance', value: urls.instance, highlight: true },
    { label: 'Recorded at', value: `${when} (UTC)` },
    { label: 'Event reference', value: data.eventId },
    ...(recorded
      ? [
          { label: 'Event type', value: recorded.eventType },
          { label: 'Recorded outcome', value: recorded.outcome },
        ]
      : []),
  ];
  const html = EmailContainer(
    EmailHeader(presentation.title, 'OpsKnight Authentication Security', {
      headerGradient: color.gradient,
      logoUrl: urls.logo,
    }) +
      EmailContent(`
      <div style="margin-bottom:16px">${StatusBadge(presentation.label, presentation.tone)}</div>
      <h2 class="desktop-font-title dm-text-heading" style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 16px;line-height:1.35;">${escapeHtml(presentation.title)}</h2>
      ${InfoCard(items, { accentColor: color.accent })}
      <div class="desktop-font-body dm-desc-box" style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${color.accent};border-radius:8px;padding:14px 18px;">
        <div class="dm-desc-label" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;margin-bottom:6px;">Recorded security summary</div>
        <div class="dm-desc-text" style="white-space:pre-wrap;word-break:break-word;font-size:14px;color:#334155;line-height:1.6;">${escapeHtml(data.message)}</div>
      </div>
      ${AlertBox('Recommended next step', presentation.guidance, presentation.tone)}
      ${EmailButton('Review authentication activity', urls.review, { buttonBackground: color.gradient })}
      <p class="dm-text-muted" style="font-size:12px;color:#64748b;line-height:1.6;word-break:break-word;">You can also open your known OpsKnight instance directly and go to System → SSO / Authentication → Diagnostics. No password or security-key response is requested by email.</p>
    `) +
      EmailFooter()
  );
  return {
    subject: `[OpsKnight] ${presentation.title}`,
    html,
    text: `${presentation.title}\n\n${items.map(item => `${item.label}: ${item.value}`).join('\n')}\n\n${data.message}\n\nRecommended next step\n${presentation.guidance}\n\nReview authentication activity: ${urls.review}\nOr open your known OpsKnight instance and go to System → SSO / Authentication → Diagnostics.\nNo password or security-key response is requested by email.\n\nOpsKnight — https://opsknight.com/`,
  };
}

export function getSsoInvitationEmailTemplate(data: {
  userName: string;
  inviteUrl: string;
  invitedBy?: string;
  expiresInDays?: number;
}) {
  const urls = authenticationEmailUrls(data.inviteUrl);
  const name = data.userName || 'there';
  const expiry = `${data.expiresInDays ?? 7} days`;
  const summary =
    'Use your organization’s SSO connection to sign in. Your first verified sign-in links this invitation; no password setup is required.';
  const items = [
    { label: 'Instance', value: urls.instance, highlight: true },
    { label: 'Sign-in method', value: 'Organization SSO' },
    { label: 'First-link approval', value: `Expires in ${expiry}` },
    ...(data.invitedBy ? [{ label: 'Invited by', value: data.invitedBy }] : []),
  ];
  return {
    subject: '[OpsKnight] Invitation to sign in with SSO',
    html: EmailContainer(
      EmailHeader('Your SSO invitation', 'OpsKnight Account Access', {
        headerGradient: colors.info.gradient,
        logoUrl: urls.logo,
      }) +
        EmailContent(`
        <div style="margin-bottom:16px">${StatusBadge('Invitation', 'info')}</div>
        <h2 class="desktop-font-title dm-text-heading" style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 16px;line-height:1.35;">Hi ${escapeHtml(name)},</h2>
        <p class="desktop-font-body dm-text-body" style="font-size:14px;color:#475569;line-height:1.6;">You have been invited${data.invitedBy ? ` by ${escapeHtml(data.invitedBy)}` : ''} to join OpsKnight.</p>
        ${InfoCard(items, { accentColor: colors.info.accent })}
        <div class="desktop-font-body dm-desc-box" style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #2563eb;border-radius:8px;padding:14px 18px;">
          <div class="dm-desc-label" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;margin-bottom:6px;">Sign in to accept</div>
          <div class="dm-desc-text" style="font-size:14px;color:#334155;line-height:1.6;">${summary}</div>
        </div>
        ${EmailButton('Sign in with SSO', urls.login, { buttonBackground: colors.info.gradient })}
        <p class="dm-text-muted" style="font-size:12px;color:#64748b;line-height:1.6;word-break:break-word;">You can also open <a href="${escapeHtml(urls.login)}" class="dm-link-color" style="color:#2563eb;">${escapeHtml(urls.login)}</a> directly and choose your organization’s SSO connection.</p>
        ${AlertBox('Invitation help', 'If this invitation was unexpected, contact your organization administrator through a known channel. If the first-link approval has expired, ask them to renew it. Do not send passwords or security-key responses by email.', 'info')}
      `) +
        EmailFooter()
    ),
    text: `Your SSO invitation\n\nHi ${name},\n\nYou have been invited${data.invitedBy ? ` by ${data.invitedBy}` : ''} to join OpsKnight.\n\n${items.map(item => `${item.label}: ${item.value}`).join('\n')}\n\n${summary}\n\nSign in with SSO: ${urls.login}\n\nIf this invitation was unexpected, contact your organization administrator through a known channel. If the first-link approval has expired, ask them to renew it. Do not send passwords or security-key responses by email.\n\nOpsKnight — https://opsknight.com/`,
  };
}

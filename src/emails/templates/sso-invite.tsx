import {
  Badge,
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  Heading,
  HeaderBand,
  InfoTable,
  Paragraph,
  TextLink,
  type InfoItem,
} from '../components';
import { OPSKNIGHT_LOGO_RATIO } from '../utils';

export type SsoInviteEmailProps = {
  name: string;
  invitedBy?: string;
  loginUrl: string;
  summary: string;
  details: InfoItem[];
  /** Logo from the canonical authenticated origin. */
  logoUrl?: string;
};

export function SsoInviteEmail({
  name,
  invitedBy,
  loginUrl,
  summary,
  details,
  logoUrl,
}: SsoInviteEmailProps) {
  return (
    <EmailLayout
      title="Your SSO invitation"
      preview="Sign in with your organization's SSO to accept your OpsKnight invitation."
      footer={<EmailFooter />}
    >
      <HeaderBand
        tone="info"
        brand={{ logoUrl, logoRatio: OPSKNIGHT_LOGO_RATIO }}
        eyebrow="OpsKnight Account Access"
        title="Your SSO invitation"
      />
      <Content>
        <Badge tone="info">Invitation</Badge>
        <Heading>Hi {name},</Heading>
        <Paragraph>
          You have been invited{invitedBy ? ` by ${invitedBy}` : ''} to join OpsKnight.
        </Paragraph>
        <InfoTable items={details} tone="info" />
        <Callout tone="info" surface="muted" title="Sign in to accept">
          {summary}
        </Callout>
        <Button href={loginUrl} tone="info">
          Sign in with SSO
        </Button>
        <Paragraph muted small>
          You can also open <TextLink href={loginUrl}>{loginUrl}</TextLink> directly and choose
          your organization’s SSO connection.
        </Paragraph>
        <Callout tone="info" title="Invitation help">
          If this invitation was unexpected, contact your organization administrator through a
          known channel. If the first-link approval has expired, ask them to renew it. Do not send
          passwords or security-key responses by email.
        </Callout>
      </Content>
    </EmailLayout>
  );
}

SsoInviteEmail.PreviewProps = {
  name: 'Jordan Lee',
  invitedBy: 'Admin Team',
  loginUrl: 'https://app.opsknight.example/login',
  summary:
    'Use your organization’s SSO connection to sign in. Your first verified sign-in links this invitation; no password setup is required.',
  details: [
    { label: 'Instance', value: 'https://app.opsknight.example', highlight: true },
    { label: 'Sign-in method', value: 'Organization SSO' },
    { label: 'First-link approval', value: 'Expires in 7 days' },
    { label: 'Invited by', value: 'Admin Team' },
  ],
} satisfies SsoInviteEmailProps;

export default SsoInviteEmail;

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
  type InfoItem,
} from '../components';
import { OPSKNIGHT_LOGO_RATIO } from '../utils';
import type { EmailTone } from '../tokens';

export type AuthSecurityEmailProps = {
  title: string;
  label: string;
  tone: EmailTone;
  guidance: string;
  message: string;
  details: InfoItem[];
  reviewUrl: string;
  /** Logo from the canonical authenticated origin (never event context). */
  logoUrl?: string;
};

export function AuthSecurityEmail({
  title,
  label,
  tone,
  guidance,
  message,
  details,
  reviewUrl,
  logoUrl,
}: AuthSecurityEmailProps) {
  return (
    <EmailLayout
      title={title}
      preview={`${label}: review this authentication activity on your OpsKnight instance.`}
      footer={<EmailFooter reason="This is an automated security message from" />}
    >
      <HeaderBand
        tone={tone}
        brand={{ logoUrl, logoRatio: OPSKNIGHT_LOGO_RATIO }}
        eyebrow="OpsKnight Authentication Security"
        title={title}
      />
      <Content>
        <Badge tone={tone}>{label}</Badge>
        <Heading>{title}</Heading>
        <InfoTable items={details} tone={tone} />
        <Callout tone={tone} surface="muted" title="Recorded security summary" preformatted>
          {message}
        </Callout>
        <Callout tone={tone} title="Recommended next step">
          {guidance}
        </Callout>
        <Button href={reviewUrl} tone={tone}>
          Review authentication activity
        </Button>
        <Paragraph muted small>
          You can also open your known OpsKnight instance directly and go to System → SSO /
          Authentication → Diagnostics. No password or security-key response is requested by email.
        </Paragraph>
      </Content>
    </EmailLayout>
  );
}

AuthSecurityEmail.PreviewProps = {
  title: 'Authentication policy changed',
  label: 'Policy updated',
  tone: 'elevated',
  guidance:
    'Confirm the change was authorized. If it was unexpected, contact your deployment administrator using an independent channel.',
  message: 'Password sign-in was disabled for all users except break-glass administrators.',
  details: [
    { label: 'Instance', value: 'https://app.opsknight.example', highlight: true },
    { label: 'Recorded at', value: '2026-11-05T10:15:00.000Z (UTC)' },
    { label: 'Event reference', value: 'evt_01JC8Q3M4N' },
    { label: 'Event type', value: 'auth.policy.changed' },
    { label: 'Recorded outcome', value: 'success' },
  ],
  reviewUrl:
    'https://app.opsknight.example/settings/system?section=sso&authTab=diagnostics&authView=audit',
} satisfies AuthSecurityEmailProps;

export default AuthSecurityEmail;

import {
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  LinkFallback,
  Paragraph,
  Strong,
  SubscriberFooter,
} from '../components';

export type StatusVerificationEmailProps = {
  pageName: string;
  logoUrl?: string;
  statusPageUrl: string;
  verificationUrl: string;
  unsubscribeUrl?: string;
};

export function StatusVerificationEmail({
  pageName,
  logoUrl,
  statusPageUrl,
  verificationUrl,
  unsubscribeUrl,
}: StatusVerificationEmailProps) {
  return (
    <EmailLayout
      title={`Verify your subscription to ${pageName}`}
      preview={`Confirm your email to receive ${pageName} status updates.`}
      footer={
        unsubscribeUrl ? (
          <SubscriberFooter pageName={pageName} unsubscribeUrl={unsubscribeUrl} />
        ) : (
          <EmailFooter />
        )
      }
    >
      <HeaderBand
        tone="ok"
        brand={{ name: pageName, logoUrl, href: statusPageUrl }}
        eyebrow="Email verification"
        title="Confirm Your Subscription"
        subtitle={`Status updates for ${pageName}`}
      />
      <Content>
        <Paragraph>
          Please verify your email address to start receiving status updates for{' '}
          <Strong>{pageName}</Strong>. You will be notified about incidents, maintenance and
          status changes.
        </Paragraph>
        <Button href={verificationUrl} tone="ok">
          Verify Email Address
        </Button>
        <Paragraph muted small align="center">
          This link will expire in 7 days
        </Paragraph>
        <LinkFallback href={verificationUrl} />
        <Callout tone="info" title="Didn't subscribe?">
          If you did not subscribe to these updates, you can safely ignore this email.
        </Callout>
      </Content>
    </EmailLayout>
  );
}

StatusVerificationEmail.PreviewProps = {
  pageName: 'Acme Cloud',
  statusPageUrl: 'https://status.acme.example',
  verificationUrl: 'https://status.acme.example/verify/preview-token',
} satisfies StatusVerificationEmailProps;

export default StatusVerificationEmail;

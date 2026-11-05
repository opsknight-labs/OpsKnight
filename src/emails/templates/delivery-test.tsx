import {
  Badge,
  Content,
  EmailFooter,
  EmailLayout,
  Heading,
  HeaderBand,
  InfoTable,
  Paragraph,
  type InfoItem,
} from '../components';

export type DeliveryTestEmailProps = {
  /** "provider" = admin provider check; "channel" = a user testing their own email alerts. */
  variant: 'provider' | 'channel';
  greetingName?: string;
  providerLabel?: string;
  details: InfoItem[];
};

/** Provider and personal channel test emails: proves the full template renders end to end. */
export function DeliveryTestEmail({
  variant,
  greetingName,
  providerLabel,
  details,
}: DeliveryTestEmailProps) {
  const isProvider = variant === 'provider';
  return (
    <EmailLayout
      title={isProvider ? 'Provider test successful' : 'Test email alert'}
      preview={
        isProvider
          ? `OpsKnight delivered this test through ${providerLabel ?? 'your email provider'}.`
          : 'Your OpsKnight email alert channel is configured and active.'
      }
      footer={<EmailFooter />}
    >
      <HeaderBand
        tone="ok"
        eyebrow={isProvider ? 'Provider test' : 'Channel test'}
        title={isProvider ? 'Provider Test Successful' : 'Test Email Alert'}
        subtitle={isProvider ? `Delivered via ${providerLabel ?? 'your email provider'}` : undefined}
      />
      <Content>
        <Badge tone="ok">{isProvider ? 'Provider test successful' : 'Channel active'}</Badge>
        {isProvider ? null : <Heading>{`Hello ${greetingName ?? 'there'},`}</Heading>}
        <Paragraph>
          {isProvider
            ? `This is an automated test notification dispatched from your OpsKnight instance via ${providerLabel ?? 'your email provider'}.`
            : 'This is a test notification confirming that your OpsKnight email alert channel is properly configured and active.'}
        </Paragraph>
        <InfoTable tone="ok" items={details} />
        <Paragraph muted small>
          Incident alerts use this same layout, so if this message looks right in your inbox (in
          light and dark mode), real alerts will too.
        </Paragraph>
      </Content>
    </EmailLayout>
  );
}

DeliveryTestEmail.PreviewProps = {
  variant: 'provider',
  providerLabel: 'SMTP',
  details: [
    { label: 'Provider', value: 'SMTP', highlight: true },
    { label: 'Dispatched by', value: 'Alex Morgan (ADMIN)' },
    { label: 'Timestamp', value: '2026-11-05T10:15:00.000Z' },
  ],
} satisfies DeliveryTestEmailProps;

export default DeliveryTestEmail;

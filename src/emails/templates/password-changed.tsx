import {
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  InfoTable,
  Paragraph,
} from '../components';

export type PasswordChangedEmailProps = {
  userName: string;
  changedAt: string;
  loginUrl?: string;
};

export function PasswordChangedEmail({ userName, changedAt, loginUrl }: PasswordChangedEmailProps) {
  return (
    <EmailLayout
      title="Your OpsKnight password was changed"
      preview="Your OpsKnight password was just changed. If this wasn't you, act now."
      footer={<EmailFooter reason="This is an automated security message from" />}
    >
      <HeaderBand
        tone="ok"
        eyebrow="OpsKnight Account Security"
        title="Your password was changed"
      />
      <Content>
        <Paragraph>
          Hi {userName}, the password for your OpsKnight account was changed successfully.
        </Paragraph>
        <InfoTable tone="ok" items={[{ label: 'Changed at', value: changedAt, highlight: true }]} />
        <Callout tone="critical" title="Wasn't you?">
          If you did not make this change, contact your administrator immediately. They can lock
          the account and revoke active sessions.
        </Callout>
        {loginUrl ? (
          <Button href={loginUrl} tone="neutral">
            Sign in to OpsKnight
          </Button>
        ) : null}
      </Content>
    </EmailLayout>
  );
}

PasswordChangedEmail.PreviewProps = {
  userName: 'Alex Morgan',
  changedAt: '2026-11-05T10:15:00.000Z (UTC)',
  loginUrl: 'https://app.opsknight.example/login',
} satisfies PasswordChangedEmailProps;

export default PasswordChangedEmail;

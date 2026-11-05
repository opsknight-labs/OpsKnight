import {
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  LinkFallback,
  Paragraph,
} from '../components';

export type PasswordResetEmailProps = {
  userName: string;
  resetLink: string;
  expiryText: string;
};

export function PasswordResetEmail({ userName, resetLink, expiryText }: PasswordResetEmailProps) {
  return (
    <EmailLayout
      title="Reset your OpsKnight password"
      preview={`Use this link within ${expiryText} to choose a new OpsKnight password.`}
      footer={<EmailFooter reason="This is an automated security message from" />}
    >
      <HeaderBand
        tone="neutral"
        eyebrow="OpsKnight Account Security"
        title="Reset Your Password"
      />
      <Content>
        <Paragraph>Hi {userName}, we received a request to reset your password.</Paragraph>
        <Paragraph>Click the button below to create a new password for your account:</Paragraph>
        <Button href={resetLink} tone="neutral">
          Reset Password
        </Button>
        <Paragraph muted small align="center">
          This link expires in {expiryText}
        </Paragraph>
        <LinkFallback href={resetLink} />
        <Callout tone="elevated" title="Security Notice">
          If you did not request a password reset, you can safely ignore this email. Your password
          will not be changed.
        </Callout>
      </Content>
    </EmailLayout>
  );
}

PasswordResetEmail.PreviewProps = {
  userName: 'Alex Morgan',
  resetLink: 'https://app.opsknight.example/reset-password/preview-token',
  expiryText: '60 minutes',
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;

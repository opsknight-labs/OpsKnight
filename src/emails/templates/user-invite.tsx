import {
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  Heading,
  HeaderBand,
  LinkFallback,
  Paragraph,
  Strong,
} from '../components';

export type UserInviteEmailProps = {
  greetingName: string;
  invitedBy?: string;
  inviteUrl: string;
  expiresText: string;
};

export function UserInviteEmail({
  greetingName,
  invitedBy,
  inviteUrl,
  expiresText,
}: UserInviteEmailProps) {
  return (
    <EmailLayout
      title="You're invited to join OpsKnight"
      preview={`${invitedBy ? `${invitedBy} invited you` : 'You are invited'} to join OpsKnight. Set up your account.`}
      footer={<EmailFooter />}
    >
      <HeaderBand
        tone="info"
        eyebrow="OpsKnight Account Access"
        title="You're invited to OpsKnight"
        subtitle={invitedBy ? `Invited by ${invitedBy}` : undefined}
      />
      <Content>
        <Heading>Hi {greetingName},</Heading>
        <Paragraph>
          You have been invited{invitedBy ? (
            <>
              {' '}
              by <Strong>{invitedBy}</Strong>
            </>
          ) : null}{' '}
          to join OpsKnight.
        </Paragraph>
        <Paragraph>Click the button below to set your password and access your account.</Paragraph>
        <Button href={inviteUrl} tone="info">
          Set up your account
        </Button>
        <Paragraph muted small align="center">
          This invite link expires in {expiresText}
        </Paragraph>
        <LinkFallback href={inviteUrl} />
        <Callout tone="info" title="Security note">
          If you did not expect this invitation, you can safely ignore this email.
        </Callout>
      </Content>
    </EmailLayout>
  );
}

UserInviteEmail.PreviewProps = {
  greetingName: 'Jordan Lee',
  invitedBy: 'Admin Team',
  inviteUrl: 'https://app.opsknight.example/invite/preview-token',
  expiresText: '7 days',
} satisfies UserInviteEmailProps;

export default UserInviteEmail;

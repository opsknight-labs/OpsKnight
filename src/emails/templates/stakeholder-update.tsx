import {
  Badge,
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  Heading,
  LinkFallback,
  Paragraph,
} from '../components';
import { statusUpdatePresentation } from './status-update';

export type StakeholderUpdateEmailProps = {
  /** Business services the update is about, by name. */
  businessServiceNames: string[];
  /** investigating | identified | monitoring | resolved | update */
  phase: string;
  title: string;
  message: string;
  /** Pre-formatted "sent at" text. */
  postedAt?: string;
  /** Where the stakeholder follows live status (the internal status dashboard). */
  dashboardUrl: string;
  /** Notification settings, to stop following. */
  settingsUrl?: string;
  /** Overrides for non-incident updates (error budgets): band label, tone and eyebrow. */
  label?: string;
  tone?: ReturnType<typeof statusUpdatePresentation>['tone'];
  eyebrow?: string;
  buttonLabel?: string;
};

/** Plain-language stakeholder update: the business impact, not the component. */
export function StakeholderUpdateEmail({
  businessServiceNames,
  phase,
  title,
  message,
  postedAt,
  dashboardUrl,
  settingsUrl,
  eyebrow = 'Stakeholder update',
  buttonLabel = 'View status dashboard',
  ...override
}: StakeholderUpdateEmailProps) {
  const presentation = statusUpdatePresentation(phase);
  const label = override.label ?? presentation.label;
  const tone = override.tone ?? presentation.tone;
  const names = businessServiceNames.join(', ');
  return (
    <EmailLayout
      title={`${label}: ${title}`}
      preview={`${names} · ${label}: ${title}`}
      footer={
        <EmailFooter
          settingsUrl={settingsUrl}
          reason="You receive this because you follow, or your team subscribes to, these business services in"
        />
      }
    >
      <HeaderBand tone={tone} eyebrow={eyebrow} title={label} subtitle={title} />
      <Content>
        <Badge tone={tone}>{label}</Badge>
        <Paragraph muted small>
          {businessServiceNames.length > 1
            ? 'Affected business services'
            : 'Affected business service'}
        </Paragraph>
        <Heading>{names}</Heading>
        <Callout tone={tone} surface="muted" title="Update" preformatted>
          {message}
          {postedAt ? `\n\nSent ${postedAt}` : null}
        </Callout>
        <Button href={dashboardUrl} tone={tone}>
          {buttonLabel}
        </Button>
        <LinkFallback href={dashboardUrl} />
      </Content>
    </EmailLayout>
  );
}

StakeholderUpdateEmail.PreviewProps = {
  businessServiceNames: ['Checkout', 'Payments'],
  phase: 'identified',
  title: 'Card payments are failing for some customers',
  message:
    'We found the cause and are rolling back a configuration change. Next update in 30 minutes.',
  postedAt: 'Nov 22, 2026, 10:42 UTC',
  dashboardUrl: 'https://opsknight.example/status-dashboard',
  settingsUrl: 'https://opsknight.example/settings/notifications',
} satisfies StakeholderUpdateEmailProps;

export default StakeholderUpdateEmail;

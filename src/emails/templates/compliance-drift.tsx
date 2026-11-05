import {
  Badge,
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  InfoTable,
  LinkFallback,
  Paragraph,
} from '../components';

export type ComplianceDriftEmailProps = {
  controlId: string;
  summary: string;
  kind: string;
  impact: string;
  detectedAt: string;
  reviewUrl?: string;
};

export function ComplianceDriftEmail({
  controlId,
  summary,
  kind,
  impact,
  detectedAt,
  reviewUrl,
}: ComplianceDriftEmailProps) {
  return (
    <EmailLayout
      title={`Compliance drift: control ${controlId}`}
      preview={`Compliance drift observed for control ${controlId}: ${summary}`}
      footer={<EmailFooter reason="This is an automated compliance alert from" />}
    >
      <HeaderBand
        tone="elevated"
        eyebrow="OpsKnight Compliance"
        title="Compliance Drift Alert"
        subtitle={`Control ${controlId}`}
      />
      <Content>
        <Badge tone="elevated">Drift detected</Badge>
        <Paragraph>
          OpsKnight observed a runtime control drifting from its expected state. Review the
          evidence and remediate or accept the drift.
        </Paragraph>
        <Callout tone="elevated" surface="muted" title="Summary" preformatted>
          {summary}
        </Callout>
        <InfoTable
          tone="elevated"
          items={[
            { label: 'Control', value: controlId, highlight: true },
            { label: 'Kind', value: kind },
            { label: 'Impact', value: impact },
            { label: 'Detected at', value: detectedAt },
          ]}
        />
        {reviewUrl ? (
          <>
            <Button href={reviewUrl} tone="elevated">
              Review in Compliance Center
            </Button>
            <LinkFallback href={reviewUrl} />
          </>
        ) : null}
      </Content>
    </EmailLayout>
  );
}

ComplianceDriftEmail.PreviewProps = {
  controlId: 'SOC2-CC6.1',
  summary: 'MFA enforcement was disabled for the Administrators role.',
  kind: 'CONFIGURATION',
  impact: 'HIGH',
  detectedAt: '2026-11-05T10:15:00.000Z',
  reviewUrl: 'https://app.opsknight.example/settings/compliance',
} satisfies ComplianceDriftEmailProps;

export default ComplianceDriftEmail;

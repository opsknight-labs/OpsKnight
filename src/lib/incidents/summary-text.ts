/**
 * A plain-text incident summary to paste into Slack, Teams or a ticket — no AI, from the incident's own fields.
 * Slack-flavoured emphasis (*bold*) reads fine as plain text elsewhere.
 */
export function incidentSummaryText(input: {
  title: string;
  priority: string | null;
  status: string;
  serviceName: string;
  assigneeName: string | null;
  createdAt: Date;
  now: Date;
  alertTotal: number;
  escalation: string | null;
  url: string;
}): string {
  const status = input.status.charAt(0) + input.status.slice(1).toLowerCase();
  const open = Math.max(0, input.now.getTime() - input.createdAt.getTime());
  const hours = Math.floor(open / 3_600_000);
  const minutes = Math.floor((open % 3_600_000) / 60_000);
  const age =
    hours >= 24
      ? `${Math.floor(hours / 24)}d ${hours % 24}h`
      : hours
        ? `${hours}h ${minutes}m`
        : `${minutes}m`;
  const lines = [
    `*${input.priority ? `[${input.priority}] ` : ''}${input.title}*`,
    `${status} · open ${age} · ${input.serviceName}`,
    [
      `Assignee: ${input.assigneeName ?? 'unassigned'}`,
      input.escalation ? `Escalation: ${input.escalation}` : null,
      input.alertTotal ? `${input.alertTotal} alert${input.alertTotal === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    input.url,
  ];
  return lines.join('\n');
}

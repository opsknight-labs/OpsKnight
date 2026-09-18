import type { WarRoomProjectionModel } from '../../projection-model';
import { slackContractForKind } from '@/lib/chatops/slack-action-map';

type _SlackRenderAction = WarRoomProjectionModel['actions'][number] | 'ASSIGN_TO_ME';

function isSlackSupported(action: string): boolean {
  // string to allow ASSIGN_TO_ME compat
  return (
    action === 'ACKNOWLEDGE' ||
    action === 'ASSIGN_SELF' ||
    action === 'ASSIGN_TO_ME' ||
    action === 'RESOLVE'
  );
}

function formatMeetingLabel(provider: string): string {
  switch (provider) {
    case 'MICROSOFT_TEAMS':
      return 'Teams';
    case 'ZOOM':
      return 'Zoom';
    case 'GOOGLE_MEET':
      return 'Google Meet';
    case 'JITSI':
      return 'Jitsi';
    default:
      return 'Video';
  }
}

export function renderSlackWarRoomProjection(model: WarRoomProjectionModel) {
  const summary = `*${model.incident.title}*\n${model.incident.serviceName} · ${model.incident.urgency}${model.incident.priority ? ` · ${model.incident.priority}` : ''}`;
  // P1-10: fail-closed — unsupported semantic actions are omitted, never mapped to Resolve.
  const supportedActions = (model.actions as readonly string[]).filter(
    isSlackSupported
  ) as unknown as typeof model.actions;
  return {
    text: `${model.phase}: ${model.incident.title}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: summary } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${model.incident.url}|Open incident> · ${model.incident.status}${model.incident.assigneeName ? ` · ${model.incident.assigneeName}` : ''} · <https://opsknight.com|OpsKnight>`,
          },
        ],
      },
      ...(model.meeting?.joinUrl && model.phase !== 'RESOLVED'
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Meeting Bridge*: <${model.meeting.joinUrl}|Join ${formatMeetingLabel(model.meeting.provider)} Meeting>`,
              },
              accessory: {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: `Join ${formatMeetingLabel(model.meeting.provider)} Meeting`,
                },
                url: model.meeting.joinUrl,
                style: 'primary',
              },
            },
          ]
        : []),
      ...(supportedActions.length
        ? [
            {
              type: 'actions',
              elements: supportedActions
                .map(action => {
                  const normalized = (action as string) === 'ASSIGN_TO_ME' ? 'ASSIGN_SELF' : action;
                  const contract = slackContractForKind(normalized as never);
                  if (!contract) return null;
                  return {
                    type: 'button',
                    action_id: contract.actionId,
                    text: { type: 'plain_text', text: contract.label },
                    value: JSON.stringify({
                      action: contract.actionValue,
                      incidentId: model.incident.id,
                    }),
                  };
                })
                .filter(Boolean),
            },
          ]
        : []),
    ],
  };
}

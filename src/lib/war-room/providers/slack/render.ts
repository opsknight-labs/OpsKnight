import type { WarRoomProjectionModel } from '../../projection-model';

type SlackRenderAction = WarRoomProjectionModel['actions'][number] | 'ASSIGN_TO_ME';

function actionLabel(action: SlackRenderAction): string {
  if (action === 'ACKNOWLEDGE') return 'Acknowledge';
  if (action === 'ASSIGN_TO_ME' || action === 'ASSIGN_SELF') return 'Assign to me';
  return 'Resolve';
}

function actionToSlackContract(action: SlackRenderAction): { actionId: string; actionValue: string } {
  if (action === 'ACKNOWLEDGE') return { actionId: 'ack_incident', actionValue: 'ack' };
  if (action === 'ASSIGN_TO_ME' || action === 'ASSIGN_SELF') return { actionId: 'assign_me_incident', actionValue: 'assign_me' };
  return { actionId: 'resolve_incident', actionValue: 'resolve' };
}

export function renderSlackWarRoomProjection(model: WarRoomProjectionModel) {
  const summary = `*${model.incident.title}*\n${model.incident.serviceName} · ${model.incident.urgency}${model.incident.priority ? ` · ${model.incident.priority}` : ''}`;
  return {
    text: `${model.phase}: ${model.incident.title}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: summary } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${model.incident.url}|Open incident> · ${model.incident.status}${model.incident.assigneeName ? ` · ${model.incident.assigneeName}` : ''}`,
          },
        ],
      },
      ...(model.actions.length
        ? [
            {
              type: 'actions',
              elements: model.actions.map(action => {
                const contract = actionToSlackContract(action);
                return {
                  type: 'button',
                  action_id: contract.actionId,
                  text: { type: 'plain_text', text: actionLabel(action) },
                  value: JSON.stringify({ action: contract.actionValue, incidentId: model.incident.id }),
                };
              }),
            },
          ]
        : []),
    ],
  };
}

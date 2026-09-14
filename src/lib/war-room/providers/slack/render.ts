import type { WarRoomProjectionModel } from '../../projection-model';

function actionLabel(action: WarRoomProjectionModel['actions'][number]): string {
  if (action === 'ACKNOWLEDGE') return 'Acknowledge';
  if (action === 'ASSIGN_TO_ME') return 'Assign to me';
  return 'Resolve';
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
              elements: model.actions.map(action => ({
                type: 'button',
                action_id: `incident_${action.toLowerCase()}`,
                text: { type: 'plain_text', text: actionLabel(action) },
                value: model.incident.id,
              })),
            },
          ]
        : []),
    ],
  };
}

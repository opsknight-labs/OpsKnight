import type { WarRoomProjectionModel } from '../../projection-model';

/** Provider renderer kept free of lifecycle and persistence decisions. */
export function renderMicrosoftTeamsWarRoomProjection(model: WarRoomProjectionModel) {
  return {
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: model.incident.title },
      {
        type: 'FactSet',
        facts: [
          { title: 'Status', value: model.incident.status },
          { title: 'Urgency', value: model.incident.urgency },
          { title: 'Service', value: model.incident.serviceName },
          ...(model.incident.assigneeName
            ? [{ title: 'Assignee', value: model.incident.assigneeName }]
            : []),
        ],
      },
    ],
    actions: model.actions.map(action => ({
      type: 'Action.Execute',
      title: action === 'ASSIGN_TO_ME' ? 'Assign to me' : action[0] + action.slice(1).toLowerCase(),
      verb: action.toLowerCase(),
      data: { incidentId: model.incident.id },
    })),
  };
}

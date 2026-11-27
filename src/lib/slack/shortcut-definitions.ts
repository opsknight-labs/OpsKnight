/**
 * Slack shortcut definitions. Pure data, so the app manifest (which client components import) can use
 * them without pulling in the server-only shortcut handlers.
 */

export const DECLARE_FROM_MESSAGE_CALLBACK = 'declare_from_message';
export const DECLARE_GLOBAL_CALLBACK = 'declare_incident';

/** The manifest's `features.shortcuts` array. */
export const SLACK_SHORTCUTS = [
  {
    name: 'Declare incident',
    type: 'message',
    callback_id: DECLARE_FROM_MESSAGE_CALLBACK,
    description: 'Declare an OpsKnight incident from this message',
  },
  {
    name: 'Declare incident',
    type: 'global',
    callback_id: DECLARE_GLOBAL_CALLBACK,
    description: 'Declare an OpsKnight incident',
  },
] as const;

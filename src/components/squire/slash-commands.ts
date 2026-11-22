/**
 * "/" shortcuts in the message box. Each one sends a question basic mode already answers, so they work
 * with AI off; /new starts a fresh chat instead of asking anything.
 */
export type SlashCommand = {
  name: string;
  hint: string;
  /** The question sent; absent for /new. */
  prompt?: string;
  /** Only offered in a chat about an incident. */
  incidentOnly?: boolean;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'fire', hint: 'What is on fire right now', prompt: 'What is on fire right now?' },
  { name: 'mine', hint: 'Your open incidents', prompt: 'My open incidents' },
  { name: 'oncall', hint: 'Who is on call', prompt: 'Who is on call?' },
  {
    name: 'similar',
    hint: 'Similar past incidents',
    prompt: 'Similar incidents?',
    incidentOnly: true,
  },
  {
    name: 'cause',
    hint: 'What could have caused this',
    prompt: 'What could have caused this?',
    incidentOnly: true,
  },
  {
    name: 'runbook',
    hint: 'A runbook that fits',
    prompt: 'Which runbook fits?',
    incidentOnly: true,
  },
  {
    name: 'who',
    hint: 'Who is assigned',
    prompt: 'Who is assigned to this incident?',
    incidentOnly: true,
  },
  { name: 'week', hint: 'Incidents this week', prompt: 'How many incidents this week?' },
  { name: 'help', hint: 'What I can do', prompt: 'Help' },
  { name: 'new', hint: 'Start a new chat' },
];

/** Commands matching a box that holds only "/" plus the start of a name; empty otherwise. */
export function matchSlashCommands(value: string, inIncident: boolean): SlashCommand[] {
  if (!value.startsWith('/') || /\s/.test(value)) return [];
  const typed = value.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter(
    command => (inIncident || !command.incidentOnly) && command.name.startsWith(typed)
  );
}

import type { SquireIntent } from '../intents';
import type { ReadableIncident } from '../deterministic';
import type { Slots } from './nlu';

export interface SuggestionContext {
  intent: SquireIntent;
  incident: ReadableIncident | null;
  mode: 'basic' | 'ai';
  slots?: Slots;
  /** The answer was a list with more rows than it showed. */
  hasMore?: boolean;
  /** The answer asked a clarifying question; the chips are its choices. */
  choices?: string[];
  /** A filter already present in the question, so the chip to add it is not offered. */
  filters?: { urgency?: boolean; status?: boolean; window?: boolean; service?: boolean };
}

const GLOBAL_DEFAULTS = ['What is on fire right now?', 'Who is on call?', 'My open incidents'];

/**
 * Follow-up chips chosen from what was just answered, not from the page alone: a list offers to page or
 * narrow, a report offers a breakdown or comparison, a service answer offers its on-call and incidents.
 * Deterministic and free, so they are computed on every turn.
 */
export function suggestFollowUps(context: SuggestionContext): string[] {
  const { intent, incident, mode, slots, filters } = context;
  if (context.choices?.length) return context.choices.slice(0, 4);
  const chips: string[] = [];
  const push = (...items: string[]) => {
    for (const item of items)
      if (item && !chips.includes(item) && chips.length < 4) chips.push(item);
  };
  if (context.hasMore) push('Show more');
  switch (intent) {
    case 'WORK_QUEUE':
    case 'SEARCH_INCIDENTS':
    case 'ACTIVE_INCIDENTS':
      if (!filters?.urgency) push('Only high urgency');
      if (!filters?.window) push('Only the last 24 hours');
      push('How many incidents this week?', 'Group them by service');
      break;
    case 'INCIDENT_STATS':
      push(
        slots?.groupBy === 'team' ? 'Break it down by urgency' : 'Break it down by team',
        'Compare with the previous period',
        'Which services are noisiest?',
        'What is our MTTR this month?'
      );
      break;
    case 'ALERT_STATS':
      push('How many incidents this week?', 'Show open incidents', 'Which services are noisiest?');
      break;
    case 'SERVICE_HEALTH':
      push(
        'Who is on call for it?',
        'Open incidents for this service',
        'Recent changes for this service',
        'Runbooks for this service'
      );
      break;
    case 'ON_CALL':
      push('Who is on call tomorrow?', 'What is on fire right now?', 'Show unassigned incidents');
      break;
    case 'RECENT_CHANGES':
      push('Incidents since those changes', 'Who owns that service?', 'What is on fire right now?');
      break;
    case 'RUNBOOK_SEARCH':
      push('Open incidents right now', 'Who is on call?');
      break;
    case 'FOLLOWUPS':
      push('Only overdue items', 'My tasks', 'Recent postmortems');
      break;
    case 'POSTMORTEMS':
      push('Follow-up items', 'Resolved incidents last week');
      break;
    case 'RESPONDERS':
      push('Who is on call for this?', 'Acknowledge this incident', 'Show the timeline');
      break;
    case 'TIMELINE':
      push('Have we seen this before?', 'What changed before this started?', 'Which runbook fits?');
      break;
    case 'SIMILAR':
      push('What changed before this started?', 'Which runbook fits?', 'Show the timeline');
      break;
    case 'CAUSES':
      push('Have we seen this before?', 'Which runbook fits?', 'Who is on call for this?');
      break;
    case 'RUNBOOKS':
      push('Have we seen this before?', 'What changed before this started?');
      break;
    case 'INCIDENT_SUMMARY':
      push('Show the timeline', 'Have we seen this before?', 'What changed before this started?');
      break;
    default:
      break;
  }
  if (incident) {
    if (incident.status === 'RESOLVED')
      push(
        'Have we seen this before?',
        mode === 'ai' ? 'Draft the postmortem' : 'Which runbook fits?'
      );
    else
      push(
        'What changed before this started?',
        'Have we seen this before?',
        mode === 'ai' ? 'Draft a status update note' : 'Which runbook fits?'
      );
  } else {
    push(...GLOBAL_DEFAULTS);
    if (mode === 'ai') push('Any incidents like this in the last week?');
    else push('How many incidents this week?');
  }
  return chips.slice(0, 4);
}

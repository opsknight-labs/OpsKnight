/**
 * The two looks an incident field value may have, shared by every field in the incident details band
 * (priority, urgency, visibility, assignee, escalation, service, policy, opened).
 *
 * - FIELD_SELECT_CLASS: something you can change. Always a bordered select button with a chevron, never
 *   anything else, so every dropdown on the page reads the same.
 * - FIELD_VALUE_CLASS: something you can only read (or may not edit). Same height and type as a select so
 *   the row lines up, but no border, background or chevron, so it never poses as a dropdown.
 */
export const FIELD_SELECT_CLASS =
  'group inline-flex h-8 max-w-full cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-background px-2.5 text-sm font-medium text-foreground shadow-2xs transition-colors hover:bg-muted/60';

export const FIELD_VALUE_CLASS =
  'inline-flex h-8 max-w-full cursor-default items-center gap-1.5 whitespace-nowrap text-sm font-medium text-foreground';

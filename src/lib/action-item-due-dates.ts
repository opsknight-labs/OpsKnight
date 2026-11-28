/**
 * Action item due dates are calendar dates stored at 00:00 UTC. They are read in UTC and become
 * overdue only once their whole UTC day has passed, so a viewer west of UTC never sees one a day
 * early, and nobody is told about an item the day before it is due.
 */
export function actionItemOverdueBefore(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

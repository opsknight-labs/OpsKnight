export function executionDurationSeconds(
  startedAt: Date | string | null | undefined,
  completedAt: Date | string | null | undefined,
  now: Date | string | number
): number | null {
  if (!startedAt) return null;
  const end = completedAt ? new Date(completedAt) : new Date(now);
  return Math.max(0, Math.round((end.getTime() - new Date(startedAt).getTime()) / 1000));
}

export function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null) return 'Not started';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatRelativeTime(value: Date | string, now: Date | string | number): string {
  const seconds = Math.round((new Date(now).getTime() - new Date(value).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

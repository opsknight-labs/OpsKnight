import { ExternalLink, Tickets } from 'lucide-react';
import { sanitizeJiraHttpUrl, type JiraIssueReference } from '@/lib/jira-references';
import { cn } from '@/lib/utils';

function statusColor(status: string | undefined): string {
  if (!status) return 'bg-ink-100 text-ink-600';
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved')
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (lower === 'in progress' || lower === 'in review')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
  if (lower === 'to do' || lower === 'open' || lower === 'backlog')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  return 'bg-ink-100 text-ink-600';
}

export default function JiraReferenceBadge({
  issue,
  compact = false,
  contextLabel,
  className,
}: {
  issue: JiraIssueReference;
  compact?: boolean;
  contextLabel?: string;
  className?: string;
}) {
  // Treat every render as a trust boundary as well as sanitizing at
  // serialization. This protects hand-built props in tests/future callers.
  const safeUrl = sanitizeJiraHttpUrl(issue.url);
  const title = `${contextLabel ? `${contextLabel}: ` : ''}${issue.key}${issue.status ? ` — ${issue.status}` : ''}${issue.assignee ? ` (${issue.assignee})` : ''}`;
  const classes = cn(
    'inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 transition-colors dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
    safeUrl && 'hover:bg-blue-100 dark:hover:bg-blue-500/15',
    !safeUrl && 'cursor-default',
    className
  );

  const content = (
    <>
      {contextLabel && (
        <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-500">
          {contextLabel}
        </span>
      )}
      <Tickets className="h-3 w-3" aria-hidden="true" />
      <span>{issue.key}</span>
      {!compact && issue.status && (
        <span
          className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium ${statusColor(issue.status)}`}
        >
          {issue.status}
        </span>
      )}
      {safeUrl && <ExternalLink className="h-2.5 w-2.5 opacity-50" aria-hidden="true" />}
    </>
  );

  if (!safeUrl) {
    return (
      <span className={classes} title={title} onClick={event => event.stopPropagation()}>
        {content}
      </span>
    );
  }

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={classes}
      title={title}
      onClick={event => event.stopPropagation()}
    >
      {content}
    </a>
  );
}

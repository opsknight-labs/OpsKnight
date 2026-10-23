'use client';

import { memo, useMemo, type ReactNode } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Clock, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type NoteCardProps = {
  content: string;
  userId?: string;
  userName: string;
  userAvatar?: string | null;
  userGender?: string | null;
  createdAt: Date;
  isResolution?: boolean;
};

function NoteCard({
  content,
  userId,
  userName,
  userAvatar,
  userGender,
  createdAt,
  isResolution = false,
}: NoteCardProps) {
  const { userTimeZone } = useTimezone();

  // Render links as React elements so React performs attribute escaping.
  // Never pass note content through dangerouslySetInnerHTML.
  const formattedContent = useMemo(() => {
    const displayContent =
      isResolution && content.startsWith('Resolution:')
        ? content.replace(/^Resolution:\s*/i, '')
        : content;
    const nodes: ReactNode[] = [];
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let cursor = 0;
    for (const match of displayContent.matchAll(linkPattern)) {
      const index = match.index ?? 0;
      nodes.push(displayContent.slice(cursor, index));
      let safeUrl: string | null = null;
      try {
        safeUrl = new URL(match[2]).href;
      } catch {
        // Invalid markdown URLs stay plain text.
      }
      if (safeUrl) {
        nodes.push(
          <a
            key={`${index}-${safeUrl}`}
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80 transition-colors"
          >
            {match[1]}
          </a>
        );
      } else {
        nodes.push(match[0]);
      }
      cursor = index + match[0].length;
    }
    nodes.push(displayContent.slice(cursor));
    return nodes;
  }, [content, isResolution]);

  return (
    <div className="flex gap-3 items-start group">
      {/* Avatar */}
      <DirectUserAvatar
        avatarUrl={userAvatar || getDefaultAvatar(userGender, userId || userName)}
        name={userName}
        size="sm"
        className={cn(
          'ring-2 shrink-0 transition-transform group-hover:scale-105',
          isResolution ? 'ring-amber-300 dark:ring-amber-700' : 'ring-border'
        )}
        fallbackClassName={cn(
          'text-xs font-bold',
          isResolution
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
            : 'bg-muted text-muted-foreground'
        )}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">{userName}</span>
            {isResolution && (
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                <CheckCircle className="h-3 w-3" />
                Resolution
              </span>
            )}
          </div>
          <time
            dateTime={new Date(createdAt).toISOString()}
            className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0 font-mono"
          >
            <Clock className="h-3 w-3 text-muted-foreground/60" />
            <span>{formatDateTime(createdAt, userTimeZone, { format: 'datetime' })}</span>
          </time>
        </div>

        <div
          className={cn(
            'p-3 rounded-xl border text-xs leading-relaxed whitespace-pre-wrap break-words transition-colors shadow-2xs',
            isResolution
              ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/60 text-foreground'
              : 'bg-card border-border/70 text-foreground'
          )}
        >
          {formattedContent}
        </div>
      </div>
    </div>
  );
}

// Memoize NoteCard to prevent unnecessary re-renders in note lists
export default memo(NoteCard);

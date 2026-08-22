'use client';

import { memo, useMemo } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';

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

  // Memoize markdown formatting to avoid recalculation
  const formattedContent = useMemo(() => {
    const formatMarkdown = (input: string) => {
      let output = input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
      output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      output = output.replace(/\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>');
      output = output.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );
      output = output.replace(/\n/g, '<br />');

      return { __html: output };
    };

    const displayContent =
      isResolution && content.startsWith('Resolution:')
        ? content.replace(/^Resolution:\s*/i, '')
        : content;

    return formatMarkdown(displayContent);
  }, [content, isResolution]);

  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      {/* Avatar */}
      <DirectUserAvatar
        avatarUrl={userAvatar || getDefaultAvatar(userGender, userId || userName)}
        name={userName}
        size="sm"
        className={`ring-2 ${isResolution ? 'ring-orange-100 shadow-orange-100' : 'ring-slate-100 shadow-slate-100'} shadow-md transition-transform hover:scale-105`}
        fallbackClassName={`text-xs font-bold ${isResolution ? 'bg-orange-50 text-orange-700' : 'bg-slate-50 text-slate-700'}`}
      />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{userName}</span>
            {isResolution && (
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: '#b45309',
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  padding: '0.15rem 0.4rem',
                  borderRadius: '0px',
                }}
              >
                Resolution
              </span>
            )}
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {formatDateTime(createdAt, userTimeZone, { format: 'datetime' })}
          </span>
        </div>
        <div
          style={{
            background: isResolution
              ? 'linear-gradient(180deg, #fff7ed 0%, #fff3e0 100%)'
              : '#ffffff',
            padding: '1rem',
            borderRadius: '0px',
            border: isResolution ? '1px solid #fed7aa' : '1px solid var(--border)',
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
          dangerouslySetInnerHTML={formattedContent}
        />
      </div>
    </div>
  );
}

// Memoize NoteCard to prevent unnecessary re-renders in note lists
export default memo(NoteCard);

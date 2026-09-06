'use client';

import { useMemo, useRef, useState } from 'react';
import UserAvatar from '@/components/UserAvatar';

type User = { id: string; name: string; avatarUrl?: string | null; gender?: string | null };

type Props = {
  users: User[];
  currentAssigneeId?: string | null;
  action: (formData: FormData) => Promise<void>;
  accentColor?: string;
  inputBackground?: string;
  buttonBackground?: string;
  buttonBorder?: string;
  buttonTextColor?: string;
  searchPlaceholder?: string;
};

export default function AssigneePicker({
  users,
  currentAssigneeId,
  action,
  accentColor,
  inputBackground,
  buttonBackground,
  buttonBorder,
  buttonTextColor,
  searchPlaceholder,
}: Props) {
  const currentUser = users.find(user => user.id === currentAssigneeId);
  const [query, setQuery] = useState(currentUser?.name || '');
  const [selectedId, setSelectedId] = useState<string | null>(currentAssigneeId || null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const blurTimeout = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(user => user.name.toLowerCase().includes(q));
  }, [query, users]);

  const visible = expanded ? filtered : filtered.slice(0, 6);
  const options = [{ id: null as string | null, name: 'Unassigned' }, ...visible];
  const accentTint = accentColor ? `${accentColor}22` : 'rgba(211,47,47,0.12)';
  const inputBorder = buttonBorder || 'var(--border)';

  const selectUser = (userId: string | null, name: string) => {
    setSelectedId(userId);
    setQuery(name);
    setOpen(false);
  };

  return (
    <form action={action} style={{ display: 'grid', gap: '0.6rem' }}>
      <input type="hidden" name="assigneeId" value={selectedId || ''} />
      <div style={{ display: 'grid', gap: '0.5rem', position: 'relative' }}>
        <input
          type="text"
          placeholder={searchPlaceholder || 'Type to search...'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => {
            if (blurTimeout.current) {
              window.clearTimeout(blurTimeout.current);
            }
            setOpen(true);
          }}
          onBlur={() => {
            blurTimeout.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={e => {
            if (!open) setOpen(true);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlighted(prev => Math.min(prev + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const current = options[highlighted];
              if (current) {
                selectUser(current.id, current.name);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          style={{
            padding: '0.5rem 0.6rem',
            borderRadius: '10px',
            border: `1px solid ${inputBorder}`,
            fontSize: '0.85rem',
            background: inputBackground || '#fff',
          }}
        />
        {open && (
          <div
            style={{
              display: 'grid',
              gap: '0.4rem',
              position: 'absolute',
              top: '46px',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '0.5rem',
              boxShadow: 'var(--shadow-md)',
              zIndex: 5,
            }}
          >
            {options.map((user, index) => (
              <button
                key={user.id ?? 'unassigned'}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => selectUser(user.id, user.name)}
                style={{
                  textAlign: 'left',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '8px',
                  border: user.id === null ? '1px dashed var(--border)' : '1px solid var(--border)',
                  background: highlighted === index ? accentTint : '#fff',
                  color: user.id === null ? 'var(--text-secondary)' : 'var(--text-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {user.id && (
                  <UserAvatar
                    userId={user.id}
                    name={user.name}
                    gender={(user as User).gender}
                    size="xs"
                  />
                )}
                {user.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          className="glass-button"
          style={{
            height: '32px',
            padding: '0 0.75rem',
            fontSize: '0.8rem',
            background: buttonBackground || undefined,
            border: buttonBorder || undefined,
            color: buttonTextColor || undefined,
          }}
        >
          Assign
        </button>
        {filtered.length > 6 && (
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            {expanded ? 'Show less' : `Show ${filtered.length - 6} more`}
          </button>
        )}
      </div>
    </form>
  );
}

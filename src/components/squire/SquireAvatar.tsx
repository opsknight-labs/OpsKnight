import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SquireAvatarKind = 'ICON' | 'KNIGHT' | 'OWL' | 'ROBOT';

function Knight() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <path d="M16 3c-6 0-10 4.5-10 10.5V22c0 1 .8 2 2 2h16c1.2 0 2-1 2-2v-8.5C26 7.5 22 3 16 3z" fill="#94a3b8" />
      <path d="M16 3c-6 0-10 4.5-10 10.5V15h20v-1.5C26 7.5 22 3 16 3z" fill="#cbd5e1" />
      <rect x="9" y="15" width="14" height="4" rx="2" fill="#1e293b" />
      <circle cx="13" cy="17" r="1.2" fill="#fbbf24" />
      <circle cx="19" cy="17" r="1.2" fill="#fbbf24" />
      <path d="M16 3c1.5-2 4-2.5 6-1.5-1 1.6-3 2.8-6 2.8" fill="#ef4444" />
      <path d="M12 26h8l-1 3h-6z" fill="#64748b" />
    </svg>
  );
}

function Owl() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <path d="M6 9l3 3M26 9l-3 3" stroke="#78350f" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="16" cy="18" rx="10" ry="11" fill="#b45309" />
      <ellipse cx="16" cy="21" rx="6" ry="7" fill="#fde68a" />
      <circle cx="12" cy="14" r="4" fill="#fff" />
      <circle cx="20" cy="14" r="4" fill="#fff" />
      <circle cx="12" cy="14" r="2" fill="#1e293b" />
      <circle cx="20" cy="14" r="2" fill="#1e293b" />
      <path d="M15 17l1 2 1-2z" fill="#f59e0b" />
    </svg>
  );
}

function Robot() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full">
      <line x1="16" y1="3" x2="16" y2="7" stroke="#475569" strokeWidth="2" />
      <circle cx="16" cy="3" r="1.8" fill="#22d3ee" />
      <rect x="6" y="7" width="20" height="17" rx="5" fill="#e2e8f0" />
      <rect x="9" y="11" width="14" height="7" rx="3.5" fill="#0f172a" />
      <circle cx="13" cy="14.5" r="1.5" fill="#22d3ee" />
      <circle cx="19" cy="14.5" r="1.5" fill="#22d3ee" />
      <path d="M13 21h6" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="11" y="25" width="10" height="4" rx="2" fill="#94a3b8" />
    </svg>
  );
}

/**
 * The assistant's face. Decorative only: the name is always shown in text next to it. Motion is opt-in and
 * still suppressed for people who ask their system for reduced motion.
 */
export default function SquireAvatar({
  kind,
  animated = false,
  size = 'sm',
}: {
  kind: SquireAvatarKind;
  animated?: boolean;
  size?: 'sm' | 'md';
}) {
  const box = size === 'md' ? 'h-8 w-8' : 'h-5 w-5';
  if (kind === 'ICON') {
    return <Sparkles className={cn(size === 'md' ? 'h-5 w-5' : 'h-4 w-4', animated && 'motion-safe:animate-pulse')} aria-hidden="true" />;
  }
  return (
    <span
      aria-hidden="true"
      data-avatar={kind}
      className={cn('inline-block shrink-0', box, animated && 'motion-safe:animate-[squire-bob_2.4s_ease-in-out_infinite]')}
    >
      {kind === 'KNIGHT' ? <Knight /> : kind === 'OWL' ? <Owl /> : <Robot />}
    </span>
  );
}

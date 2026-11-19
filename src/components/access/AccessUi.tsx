import type { ReactNode } from 'react';
import {
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  Mail,
  Server,
  Settings2,
  Siren,
  Users,
  Workflow,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CapabilityGroup } from '@/lib/access/catalog';
import { StatusPill, type PillTone } from '@/components/settings/mcp/McpListKit';

/**
 * Small presentational building blocks shared by the access pages, so every list, status and
 * person reads the same way. Server-safe: no hooks.
 */

/** Vertical rhythm for content inside a SettingsSection (which only pads horizontally). */
export function SectionBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('py-5', className)}>{children}</div>;
}

const REQUEST_STATUS = new Map<string, { label: string; tone: PillTone }>([
  ['PENDING', { label: 'Pending', tone: 'warning' }],
  ['APPROVED', { label: 'Approved', tone: 'success' }],
  ['DENIED', { label: 'Declined', tone: 'danger' }],
  ['CANCELLED', { label: 'Cancelled', tone: 'neutral' }],
  ['EXPIRED', { label: 'Expired', tone: 'neutral' }],
]);

export function RequestStatusPill({ status }: { status: string }) {
  const meta = REQUEST_STATUS.get(status) ?? { label: status.toLowerCase(), tone: 'neutral' };
  return (
    <StatusPill tone={meta.tone} dot>
      {meta.label}
    </StatusPill>
  );
}

function initials(name: string | null | undefined, email: string) {
  const source = (name ?? '').trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function PersonAvatar({
  name,
  email,
  className,
}: {
  name: string | null | undefined;
  email: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground',
        className
      )}
    >
      {initials(name, email)}
    </span>
  );
}

/** Name with email underneath, beside an initials avatar. */
export function PersonCell({
  name,
  email,
  meta,
}: {
  name: string | null | undefined;
  email: string;
  meta?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonAvatar name={name} email={email} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{name ?? email}</p>
        <p className="truncate text-xs text-muted-foreground">{meta ?? (name ? email : null)}</p>
      </div>
    </div>
  );
}

/** Mail link to someone who can help, used for administrators and team owners. */
export function ContactChip({
  name,
  email,
  subject,
}: {
  name: string | null;
  email: string;
  subject?: string;
}) {
  const href = subject
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}`
    : `mailto:${email}`;
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PersonAvatar name={name} email={email} className="h-6 w-6 text-[10px]" />
      {name ?? email}
      <Mail
        className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground"
        aria-hidden="true"
      />
    </a>
  );
}

/** Label/value pair used in summary grids. */
export function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** In-page links to the sections of a long settings page. */
export function SectionJumpNav({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; count?: number; alert?: boolean }[];
}) {
  return (
    <nav aria-label={label} className="min-w-0">
      <ul className="flex flex-wrap items-center gap-1 rounded-lg border border-border/80 bg-muted/50 p-1">
        {items.map(item => (
          <li key={item.href} className="p-0">
            <a
              href={item.href}
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] font-semibold tabular-nums',
                    item.alert
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      : 'bg-muted-foreground/10'
                  )}
                >
                  {item.count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Anchor target that clears the sticky top bars when jumped to. */
export function SectionAnchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-28">
      {children}
    </div>
  );
}

export function CapabilityGroupIcon({
  group,
  className,
}: {
  group: CapabilityGroup;
  className?: string;
}) {
  const props = { className: cn('h-4 w-4', className), 'aria-hidden': true } as const;
  switch (group) {
    case 'incidents':
      return <Siren {...props} />;
    case 'services':
      return <Server {...props} />;
    case 'on_call':
      return <CalendarClock {...props} />;
    case 'runbooks':
      return <Workflow {...props} />;
    case 'reporting':
      return <BarChart3 {...props} />;
    case 'people':
      return <Users {...props} />;
    case 'governance':
      return <ClipboardCheck {...props} />;
    default:
      return <Settings2 {...props} />;
  }
}

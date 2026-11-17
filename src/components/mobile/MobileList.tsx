import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import StatusBadge, { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';
import RelativeTime from '@/components/patterns/RelativeTime';
import type { StatusTone } from '@/lib/design/status-palette';

/*
 * The /m list/card vocabulary. Every list route and detail section composes these, so a
 * responder who learns one screen can work all of them:
 *
 *   MobileListMeta      count line under the app bar ("12 services · 3 impacted")
 *   MobileSection       h2 + optional trailing link, wraps one card
 *   MobileListCard      divided card (<ul>) of rows
 *   MobileListRow       one 56px+ row: leading · title/subtitle (+badges/meta) · trailing · chevron
 *   MobileDetailHeader  the detail-route header card: leading tile, h1, badges, description, facts
 *   MobileToneBadge     status-palette pill for non-incident states (Operational, Admin, Published…)
 */

export function MobileListMeta({
  children,
  trailing,
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 px-0.5 text-xs tabular-nums text-muted-foreground',
        className
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {trailing ? <span className="min-w-0 shrink-0 truncate text-right">{trailing}</span> : null}
    </div>
  );
}

export const mobileSectionLinkClass =
  'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function MobileSection({
  id,
  title,
  count,
  action,
  description,
  children,
  className,
}: {
  /** Used to label the section (`aria-labelledby`). */
  id: string;
  title: string;
  count?: number;
  /** Trailing link/button, e.g. "View all". Keep it ≥44px (`mobileSectionLinkClass`). */
  action?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className={cn('space-y-2', className)}>
      <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 id={headingId} className="truncate text-sm font-semibold text-foreground">
            {title}
            {count !== undefined ? (
              <span className="ml-1.5 font-medium tabular-nums text-muted-foreground">{count}</span>
            ) : null}
          </h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MobileListCard({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Accessible name when the surrounding section heading does not label the list. */
  label?: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        'min-w-0 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card text-card-foreground',
        className
      )}
    >
      {children}
    </ul>
  );
}

const ROW_CLASS =
  'flex min-h-14 w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left text-card-foreground';
const ROW_INTERACTIVE_CLASS =
  'transition-colors duration-150 hover:bg-muted/50 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

export type MobileListRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Badges shown above the title (incident rows). */
  badges?: ReactNode;
  /** Small right-aligned meta on the badge line, usually a `<RelativeTime>`. */
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  /** External links open in a new tab and show no chevron. */
  external?: boolean;
  onClick?: () => void;
  /** Two-line clamp for long titles (incidents); names stay single-line. */
  titleLines?: 1 | 2;
  /** Accessible name override (links only). */
  ariaLabel?: string;
  className?: string;
};

export function MobileListRow({
  title,
  subtitle,
  badges,
  meta,
  leading,
  trailing,
  href,
  external = false,
  onClick,
  titleLines = 1,
  ariaLabel,
  className,
}: MobileListRowProps) {
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        {badges || meta ? (
          <span className="mb-1.5 flex min-w-0 items-center gap-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">{badges}</span>
            {meta ? (
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                {meta}
              </span>
            ) : null}
          </span>
        ) : null}
        <span
          className={cn(
            'block text-sm font-medium leading-snug text-foreground',
            titleLines === 2 ? 'line-clamp-2 break-words' : 'truncate'
          )}
        >
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
      {href && !external ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  if (href) {
    return (
      <li className="min-w-0">
        <Link
          href={href}
          onClick={onClick}
          aria-label={ariaLabel}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS, className)}
        >
          {body}
        </Link>
      </li>
    );
  }

  return <li className={cn(ROW_CLASS, className)}>{body}</li>;
}

/** Leading tile for rows and detail headers: an icon on a muted (or tone-tinted) square. */
export function MobileIconTile({
  icon: Icon,
  tone,
  size = 'md',
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: StatusTone | null;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border',
        size === 'lg' ? 'h-11 w-11' : 'h-9 w-9',
        tone ? toneClasses(tone).soft : 'border-transparent bg-muted text-muted-foreground'
      )}
    >
      <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
    </span>
  );
}

/** Solid status dot. Always pair with a text label (the dot is decorative). */
export function MobileStatusDot({ tone }: { tone: StatusTone | null }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', toneClasses(tone).solid)}
    />
  );
}

/** Status-palette pill for non-incident states. Incident states use `StatusBadge`. */
export function MobileToneBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: StatusTone | null;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(BADGE_BASE_CLASS, badgeSizeClass('xs'), toneClasses(tone).soft, className)}>
      {Icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          <Icon className="shrink-0" />
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export type MobileDetailFact = { label: string; value: ReactNode };

export function MobileDetailHeader({
  title,
  leading,
  badges,
  description,
  facts,
  actions,
  className,
}: {
  title: ReactNode;
  leading?: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  facts?: MobileDetailFact[];
  /** Full-width actions under the header (primary first). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground',
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-lg font-semibold leading-snug tracking-tight text-foreground">
            {title}
          </h1>
          {badges ? (
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">{badges}</div>
          ) : null}
          {description ? (
            <div className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {facts && facts.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3">
          {facts.map(fact => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{fact.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium tabular-nums text-foreground">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions ? <div className="mt-3 flex flex-col gap-2">{actions}</div> : null}
    </section>
  );
}

/**
 * The one incident row used by every /m surface that lists incidents outside the
 * swipeable queue (home, service, user, status, analytics): status + urgency, relative
 * age, two-line title and service.
 */
export function MobileIncidentRow({
  incident,
  showService = true,
}: {
  incident: {
    id: string;
    title: string;
    status: string;
    urgency?: string | null;
    createdAt: Date | string;
    serviceName?: string | null;
  };
  showService?: boolean;
}) {
  return (
    <MobileListRow
      href={`/m/incidents/${incident.id}`}
      titleLines={2}
      title={incident.title}
      subtitle={showService ? incident.serviceName || undefined : undefined}
      badges={
        <>
          <StatusBadge status={incident.status} size="xs" />
          <SeverityBadge urgency={incident.urgency} size="xs" />
        </>
      }
      meta={<RelativeTime date={incident.createdAt} />}
    />
  );
}

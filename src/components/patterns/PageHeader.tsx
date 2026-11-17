import { isValidElement, type ComponentType, type ReactNode } from 'react';
import ListReturnLink from '@/components/layout/ListReturnLink';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import DetailHeroBanner, { type DetailStatItem } from '@/components/ui/DetailHeroBanner';

export type BreadcrumbItem = { label: string; href?: string };

/** Accessible breadcrumb trail; the last item is the current page. */
export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((crumb, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${crumb.label}-${idx}`} className="flex min-w-0 items-center gap-1">
              {idx > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 text-muted-foreground/60"
                />
              )}
              {crumb.href && !isLast ? (
                <ListReturnLink
                  href={crumb.href}
                  className="truncate rounded-sm transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {crumb.label}
                </ListReturnLink>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn('truncate', isLast && 'font-medium text-foreground')}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Styles for controls placed on the always-dark header surface. Default shadcn
 * outline buttons assume a light page background, so pass these instead.
 */
export const pageHeaderActionClass =
  'border border-zinc-700/80 bg-zinc-800/90 text-zinc-100 shadow-xs hover:bg-zinc-700 hover:text-white active:bg-zinc-600 focus-visible:ring-zinc-400 focus-visible:ring-offset-zinc-950';
export const pageHeaderBadgeClass =
  'inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-800/80 px-2.5 py-0.5 text-xs font-medium text-zinc-100 tabular-nums';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** Icon tile used inside the always-dark header surface. */
export function PageHeaderIcon({ icon: Icon }: { icon: IconComponent }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20 sm:h-12 sm:w-12">
      <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
    </div>
  );
}

export type PageHeaderProps = {
  title: string;
  /** One line on what this page is for. */
  description?: ReactNode;
  /**
   * Small label above the title. Kept for parity with `DetailHeroBanner.tag`; new
   * pages should leave it out (DESIGN.md: no eyebrow labels).
   */
  eyebrow?: string;
  /** A lucide icon component (rendered in the standard tile) or a custom node. */
  icon?: IconComponent | ReactNode;
  /** Status/count badges shown above the title. */
  badges?: ReactNode;
  /** The page's one primary action (rightmost). */
  primaryAction?: ReactNode;
  /** Outline/ghost actions shown before the primary action. */
  secondaryActions?: ReactNode;
  /** Metric capsules; see `DetailStatItem`. */
  stats?: DetailStatItem[];
  statsPlacement?: 'inline' | 'bottom';
  /** Breadcrumb items or a custom node rendered above the header. */
  breadcrumbs?: BreadcrumbItem[] | ReactNode;
  /** Banner rendered under the header (e.g. an InlineNotice). */
  alert?: ReactNode;
  className?: string;
};

function isIconComponent(icon: unknown): icon is IconComponent {
  if (!icon || isValidElement(icon)) return false;
  // Function components and forwardRef/memo objects (lucide icons are forwardRef objects).
  return typeof icon === 'function' || (typeof icon === 'object' && '$$typeof' in icon);
}

/**
 * The house page header: title, description and actions on the always-dark
 * `DetailHeroBanner` surface. `DetailHeroBanner` stays the implementation; this is
 * the documented API for new pages.
 */
export default function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  badges,
  primaryAction,
  secondaryActions,
  stats,
  statsPlacement,
  breadcrumbs,
  alert,
  className,
}: PageHeaderProps) {
  const iconNode = isIconComponent(icon) ? <PageHeaderIcon icon={icon} /> : (icon as ReactNode);
  const breadcrumbNode = Array.isArray(breadcrumbs) ? (
    <Breadcrumbs items={breadcrumbs as BreadcrumbItem[]} />
  ) : (
    (breadcrumbs as ReactNode)
  );
  const actions =
    primaryAction || secondaryActions ? (
      <>
        {secondaryActions}
        {primaryAction}
      </>
    ) : undefined;

  return (
    <DetailHeroBanner
      breadcrumbSlot={breadcrumbNode || undefined}
      tag={eyebrow}
      title={title}
      subtitle={description}
      badges={badges}
      icon={iconNode || undefined}
      stats={stats}
      statsPlacement={statsPlacement}
      actions={actions}
      alert={alert}
      className={className}
    />
  );
}

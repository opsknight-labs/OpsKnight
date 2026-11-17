// Shared UI patterns. See DESIGN.md → Components for when to use each one.
export { default as StatusBadge, incidentStatusLabel, type StatusBadgeProps } from './StatusBadge';
export { default as SeverityBadge, type SeverityBadgeProps } from './SeverityBadge';
export {
  default as RelativeTime,
  formatRelativeLabel,
  type RelativeTimeProps,
  type RelativeTimeFormat,
} from './RelativeTime';
export {
  default as PageHeader,
  Breadcrumbs,
  PageHeaderIcon,
  type PageHeaderProps,
  type BreadcrumbItem,
} from './PageHeader';
export { default as FilterBar, FilterField, FilterChip, type FilterBarProps } from './FilterBar';
export { default as EmptyState, type EmptyStateProps } from './EmptyState';
export { default as ErrorState, type ErrorStateProps } from './ErrorState';
export { TableRowsSkeleton, CardGridSkeleton, DetailPageSkeleton } from './Skeletons';
export { toneClasses, type ToneKey } from './status-tone';

import type { PublicServiceStatus } from '@/lib/status-pages/public-contract';
import { statusPresentation } from '@/lib/status-pages/status-presentation';

/** Presentation-only status pill. The status is decided by V3; this only renders its label/token. */
export default function StatusBadgeV3({
  status,
  size = 'md',
}: {
  status: PublicServiceStatus;
  size?: 'sm' | 'md';
}) {
  const { label, token, icon } = statusPresentation(status);
  return (
    <span className={`status-badge status-${token} status-v3-badge--${size}`} data-status={token}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}

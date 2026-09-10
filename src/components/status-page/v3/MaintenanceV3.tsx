import type { PublicMaintenance } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';

const STATE_LABEL: Record<PublicMaintenance['state'], string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

/** Maintenance cards straight from the V3 `maintenance` section — no announcement-type guessing. */
export default function MaintenanceV3({
  maintenance,
  timeZone,
}: {
  maintenance: PublicMaintenance[] | undefined;
  timeZone: string;
}) {
  if (!maintenance || maintenance.length === 0) return null;
  return (
    <section className="status-v3-maintenance" aria-labelledby="status-v3-maintenance-heading">
      <h2 id="status-v3-maintenance-heading">Maintenance</h2>
      <ul className="status-v3-maintenance__list">
        {maintenance.map(item => (
          <li
            key={item.id}
            className={`status-v3-maintenance__item status-v3-maintenance--${item.state.toLowerCase()}`}
          >
            <div className="status-v3-maintenance__head">
              <span className="status-v3-maintenance__title">{item.title}</span>
              <span className="status-v3-maintenance__state">{STATE_LABEL[item.state]}</span>
            </div>
            <span className="status-muted" suppressHydrationWarning>
              {formatDateTime(item.startAt, timeZone, { format: 'short', hour12: true })}
              {item.endAt
                ? ` – ${formatDateTime(item.endAt, timeZone, { format: 'short', hour12: true })}`
                : ''}
            </span>
            {item.description && <p className="status-v3-maintenance__desc">{item.description}</p>}
            {item.affectedServices && item.affectedServices.length > 0 && (
              <p className="status-v3-maintenance__affected">
                Affects: {item.affectedServices.map(service => service.name).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

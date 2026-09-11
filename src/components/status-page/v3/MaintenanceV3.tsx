import { memo, useMemo } from 'react';
import type { PublicMaintenance } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';
import StatusBadge from '@/components/incident/StatusBadge';

const STATE_LABEL: Record<PublicMaintenance['state'], string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

/**
 * Compact, card-less maintenance strip matching the Region card architecture.
 * Eliminates bulky vertical boxes while keeping title, time window, badge, and expandable details.
 */
function MaintenanceV3Inner({
  maintenance,
  timeZone,
}: {
  maintenance: PublicMaintenance[] | undefined;
  timeZone: string;
}) {
  const counts = useMemo(() => {
    if (!maintenance || maintenance.length === 0) return { inProgress: 0, scheduled: 0, completed: 0 };
    let inProgress = 0;
    let scheduled = 0;
    let completed = 0;
    for (const item of maintenance) {
      if (item.state === 'IN_PROGRESS') inProgress++;
      else if (item.state === 'SCHEDULED') scheduled++;
      else if (item.state === 'COMPLETED') completed++;
    }
    return { inProgress, scheduled, completed };
  }, [maintenance]);

  if (!maintenance || maintenance.length === 0) return null;

  const { inProgress: inProgressCount, scheduled: scheduledCount, completed: completedCount } = counts;

  return (
    <section
      className="status-v3-maintenance-inline"
      aria-labelledby="status-v3-maintenance-heading"
    >
      <div className="status-v3-maintenance-inline__head">
        <div className="status-v3-maintenance-inline__title-wrap">
          <h2 id="status-v3-maintenance-heading" className="status-v3-maintenance-inline__title">
            Maintenance
          </h2>
          <span className="status-v3-maintenance-inline__subtitle">Scheduled & active windows</span>
        </div>
        <div
          className="status-v3-maintenance-inline__tally"
          aria-label={`${maintenance.length} maintenance events`}
        >
          {(() => {
            if (inProgressCount > 0) {
              return (
                <span className="status-v3-maintenance-inline__tally-pill status-v3-maintenance-inline__tally-pill--active">
                  <span className="status-v3-maintenance-inline__dot" aria-hidden="true" />
                  {inProgressCount} in progress
                </span>
              );
            }
            if (scheduledCount > 0) {
              return (
                <span className="status-v3-maintenance-inline__tally-pill status-v3-maintenance-inline__tally-pill--scheduled">
                  <span className="status-v3-maintenance-inline__dot" aria-hidden="true" />
                  {scheduledCount} scheduled
                </span>
              );
            }
            return (
              <span className="status-v3-maintenance-inline__tally-pill status-v3-maintenance-inline__tally-pill--completed">
                <span className="status-v3-maintenance-inline__dot" aria-hidden="true" />
                {completedCount} completed
              </span>
            );
          })()}
        </div>
      </div>

      <div className="status-v3-maintenance-inline__list" role="list">
        {maintenance.map(item => {
          const timeStr = `${formatDateTime(item.startAt, timeZone, { format: 'short', hour12: true })}${
            item.endAt
              ? ` – ${formatDateTime(item.endAt, timeZone, { format: 'short', hour12: true })}`
              : ''
          }`;
          const isInProgress = item.state === 'IN_PROGRESS';

          const stateClass =
            item.state === 'COMPLETED'
              ? ' status-v3-maintenance-pill--completed'
              : item.state === 'SCHEDULED'
                ? ' status-v3-maintenance-pill--scheduled'
                : '';
          return (
            <div
              key={item.id}
              className={`status-v3-maintenance-pill status-v3-maintenance--${item.state.toLowerCase()}${stateClass}${
                isInProgress ? ' status-v3-maintenance-pill--active' : ''
              }`}
              role="listitem"
              data-state={item.state}
            >
              <div className="status-v3-maintenance-pill__head">
                <div className="status-v3-maintenance-pill__lead">
                  <svg
                    className="status-v3-maintenance-pill__icon"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span className="status-v3-maintenance-pill__title">{item.title}</span>
                  <span className="status-v3-maintenance-pill__divider" aria-hidden="true" />
                  <span className="status-v3-maintenance-pill__time" suppressHydrationWarning>
                    {timeStr}
                  </span>
                </div>
                <div className="status-v3-maintenance-pill__status">
                  <StatusBadge
                    status={item.state}
                    label={STATE_LABEL[item.state]}
                    size="xs"
                    showDot
                    pulse={isInProgress}
                  />
                </div>
              </div>

              {item.description && (
                <p className="status-v3-maintenance-pill__desc">{item.description}</p>
              )}

              {(item.affectedServices && item.affectedServices.length > 0) ||
              (item.affectedRegions && item.affectedRegions.length > 0) ? (
                <div className="status-v3-maintenance-pill__meta">
                  <span className="status-v3-maintenance-pill__affected-label">Affects:</span>
                  {item.affectedServices?.map(service => (
                    <span
                      key={service.id || service.name}
                      className="status-v3-chip status-v3-chip--muted"
                    >
                      {service.name}
                    </span>
                  ))}
                  {item.affectedRegions?.map(region => (
                    <span key={region} className="status-v3-chip status-v3-chip--muted">
                      {region}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const MaintenanceV3 = memo(MaintenanceV3Inner);
export default MaintenanceV3;

import { memo, useMemo } from 'react';
import type { PublicAnnouncement, PublicChangelogEntry } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';
import StatusBadge from '@/components/incident/StatusBadge';

const TYPE_LABEL: Record<string, string> = {
  INFO: 'Info',
  WARNING: 'Warning',
  INCIDENT: 'Notice',
  MAINTENANCE: 'Maintenance',
};

function ChangelogV3Inner({
  changelog,
  timeZone,
}: {
  changelog: PublicChangelogEntry[] | undefined;
  timeZone: string;
}) {
  const recent = useMemo(() => {
    if (!changelog || changelog.length === 0) return null;
    return [...changelog].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }, [changelog]);

  if (!recent) return null;

  return (
    <section className="status-v3-changelog-inline" aria-labelledby="status-v3-changelog-heading">
      <div className="status-v3-announcements-inline__head">
        <div className="status-v3-announcements-inline__title-wrap">
          <h2 id="status-v3-changelog-heading" className="status-v3-announcements-inline__title">
            Changelog
          </h2>
          <span className="status-v3-announcements-inline__subtitle">
            Recent changes & releases
          </span>
        </div>
        <div
          className="status-v3-announcements-inline__tally"
          aria-label={`${recent.length} changelog entries`}
        >
          <span className="status-v3-announcements-inline__tally-pill status-v3-announcements-inline__tally-pill--changelog">
            <span className="status-v3-announcements-inline__dot" aria-hidden="true" />
            {recent.length} {recent.length === 1 ? 'update' : 'updates'}
          </span>
        </div>
      </div>
      <div className="status-v3-changelog-inline__list" role="list">
        {recent.map(item => (
          <div key={item.id} className="status-v3-changelog-pill" role="listitem">
            <div className="status-v3-changelog-pill__head">
              <div className="status-v3-changelog-pill__lead">
                <svg
                  className="status-v3-changelog-pill__icon"
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
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span className="status-v3-changelog-pill__title">{item.title}</span>
                <span className="status-v3-changelog-pill__divider" aria-hidden="true" />
                <span className="status-v3-changelog-pill__time" suppressHydrationWarning>
                  {formatDateTime(item.publishedAt, timeZone, { format: 'relative' })} ·{' '}
                  {formatDateTime(item.publishedAt, timeZone, { format: 'short', hour12: true })}
                </span>
              </div>
            </div>
            {item.message && <p className="status-v3-changelog-pill__desc">{item.message}</p>}
            {item.affectedServices && item.affectedServices.length > 0 && (
              <div className="status-v3-changelog-pill__meta">
                <span className="status-v3-changelog-pill__affected-label">Affects:</span>
                {item.affectedServices.map(service => (
                  <span
                    key={service.id || service.name}
                    className="status-v3-chip status-v3-chip--muted"
                  >
                    {service.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export const ChangelogV3 = memo(ChangelogV3Inner);

/**
 * Compact, card-like announcements strip matching the MaintenanceV3 architecture.
 */
function AnnouncementsV3Inner({
  announcements,
  changelog,
  timeZone,
}: {
  announcements: PublicAnnouncement[];
  changelog?: PublicChangelogEntry[];
  timeZone: string;
}) {
  const hasAnnouncements = announcements.length > 0;
  const hasChangelog = (changelog?.length ?? 0) > 0;
  if (!hasAnnouncements && !hasChangelog) return null;

  return (
    <>
      {hasAnnouncements && (
        <section
          className="status-v3-announcements-inline"
          aria-labelledby="status-v3-announcements-heading"
        >
          <div className="status-v3-announcements-inline__head">
            <div className="status-v3-announcements-inline__title-wrap">
              <h2
                id="status-v3-announcements-heading"
                className="status-v3-announcements-inline__title"
              >
                Announcements
              </h2>
              <span className="status-v3-announcements-inline__subtitle">Updates & notices</span>
            </div>
            <div
              className="status-v3-announcements-inline__tally"
              aria-label={`${announcements.length} announcements`}
            >
              <span className="status-v3-announcements-inline__tally-pill">
                <span className="status-v3-announcements-inline__dot" aria-hidden="true" />
                {announcements.length}{' '}
                {announcements.length === 1 ? 'announcement' : 'announcements'}
              </span>
            </div>
          </div>

          <div className="status-v3-announcements-inline__list" role="list">
            {announcements.map(item => {
              const typeUpper = (item.type || 'INFO').toUpperCase();
              const badgeLabel = TYPE_LABEL[typeUpper] || item.type;
              const dateStr = formatDateTime(item.startDate, timeZone, {
                format: 'short',
                hour12: true,
              });

              return (
                <div
                  key={item.id}
                  className={`status-v3-announcement-pill status-v3-announcement-pill--${typeUpper.toLowerCase()}`}
                  role="listitem"
                >
                  <div className="status-v3-announcement-pill__head">
                    <div className="status-v3-announcement-pill__lead">
                      <svg
                        className="status-v3-announcement-pill__icon"
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
                        <path d="m3 11 18-5v12L3 14v-3z" />
                        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                      </svg>
                      <span className="status-v3-announcement-pill__title">{item.title}</span>
                      <span className="status-v3-announcement-pill__divider" aria-hidden="true" />
                      <span className="status-v3-announcement-pill__time" suppressHydrationWarning>
                        {dateStr}
                      </span>
                    </div>
                    <div className="status-v3-announcement-pill__status">
                      <StatusBadge status={typeUpper} label={badgeLabel} size="xs" showDot />
                    </div>
                  </div>

                  {item.message && (
                    <p className="status-v3-announcement-pill__desc">{item.message}</p>
                  )}

                  {((item.affectedServices && item.affectedServices.length > 0) ||
                    (item.affectedRegions && item.affectedRegions.length > 0)) && (
                    <div className="status-v3-announcement-pill__meta">
                      <span className="status-v3-announcement-pill__affected-label">Affects:</span>
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
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {hasChangelog && <ChangelogV3 changelog={changelog} timeZone={timeZone} />}
    </>
  );
}

const AnnouncementsV3 = memo(AnnouncementsV3Inner);
export default AnnouncementsV3;

import type { PublicAnnouncement, PublicChangelogEntry } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';

/** Announcements and changelog as two explicit V3 lists — the frontend no longer filters by type. */
export default function AnnouncementsV3({
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
    <section className="status-v3-announcements" aria-labelledby="status-v3-announcements-heading">
      <h2 id="status-v3-announcements-heading">Announcements</h2>
      {hasAnnouncements && (
        <ul className="status-v3-announcements__list">
          {announcements.map(item => (
            <li
              key={item.id}
              className={`status-v3-announcement status-v3-announcement--${item.type.toLowerCase()}`}
            >
              <span className="status-v3-announcement__title">{item.title}</span>
              <span className="status-muted" suppressHydrationWarning>
                {formatDateTime(item.startDate, timeZone, { format: 'short', hour12: true })}
              </span>
              <p className="status-v3-announcement__message">{item.message}</p>
            </li>
          ))}
        </ul>
      )}
      {hasChangelog && (
        <div className="status-v3-changelog">
          <h3>Changelog</h3>
          <ul className="status-v3-changelog__list">
            {changelog!.map(item => (
              <li key={item.id} className="status-v3-changelog__item">
                <span className="status-v3-changelog__title">{item.title}</span>
                <span className="status-muted" suppressHydrationWarning>
                  {formatDateTime(item.publishedAt, timeZone, { format: 'short', hour12: true })}
                </span>
                <p className="status-v3-changelog__message">{item.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

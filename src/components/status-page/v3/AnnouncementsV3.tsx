'use client';

import { memo, useMemo, useState } from 'react';
import type { PublicAnnouncement, PublicChangelogEntry } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';
import StatusBadge from '@/components/incident/StatusBadge';

const TYPE_LABEL: Record<string, string> = {
  INFO: 'Info',
  WARNING: 'Warning',
  INCIDENT: 'Notice',
  MAINTENANCE: 'Maintenance',
};

const DESC_CLAMP_AT = 140;
const AFFECTS_INLINE_LIMIT = 3;

function AnnouncementIcon({ type }: { type: string }) {
  const t = type.toUpperCase();
  if (t === 'WARNING') {
    return (
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
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (t === 'INCIDENT') {
    return (
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
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (t === 'MAINTENANCE') {
    return (
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
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  }
  // INFO + fallback
  return (
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ClampedDesc({
  text,
  className,
}: {
  text: string;
  className: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > DESC_CLAMP_AT;
  return (
    <>
      <p className={`${className}${needsClamp && !expanded ? ` ${className}--clamped` : ''}`}>{text}</p>
      {needsClamp && (
        <button
          type="button"
          className="status-v3-pill__expand"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

function AffectsChips({
  services,
  regions,
}: {
  services?: { id?: string; name: string }[];
  regions?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const svc = services ?? [];
  const reg = regions ?? [];
  const total = svc.length + reg.length;
  if (total === 0) return null;
  const showAll = expanded || total <= AFFECTS_INLINE_LIMIT;
  const visibleServices = showAll ? svc : svc.slice(0, AFFECTS_INLINE_LIMIT);
  // if services fill the limit, regions are hidden until expanded
  const remainingSlots = Math.max(0, AFFECTS_INLINE_LIMIT - visibleServices.length);
  const visibleRegions = showAll ? reg : reg.slice(0, remainingSlots);
  const hiddenCount = total - (visibleServices.length + visibleRegions.length);

  return (
    <div className="status-v3-announcement-pill__meta">
      <span className="status-v3-announcement-pill__affected-label">Affects:</span>
      {visibleServices.map(service => (
        <span key={service.id || service.name} className="status-v3-chip status-v3-chip--muted">
          {service.name}
        </span>
      ))}
      {visibleRegions.map(region => (
        <span key={region} className="status-v3-chip status-v3-chip--muted">
          {region}
        </span>
      ))}
      {hiddenCount > 0 && (
        <button type="button" className="status-v3-pill__more" onClick={() => setExpanded(true)}>
          +{hiddenCount} more
        </button>
      )}
      {expanded && total > AFFECTS_INLINE_LIMIT && (
        <button type="button" className="status-v3-pill__more" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

function ChangelogAffects({ services }: { services?: { id?: string; name: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const list = services ?? [];
  if (list.length === 0) return null;
  const showAll = expanded || list.length <= AFFECTS_INLINE_LIMIT;
  const visible = showAll ? list : list.slice(0, AFFECTS_INLINE_LIMIT);
  const hiddenCount = list.length - visible.length;
  return (
    <div className="status-v3-changelog-pill__meta">
      <span className="status-v3-changelog-pill__affected-label">Affects:</span>
      {visible.map(service => (
        <span key={service.id || service.name} className="status-v3-chip status-v3-chip--muted">
          {service.name}
        </span>
      ))}
      {hiddenCount > 0 && (
        <button type="button" className="status-v3-pill__more" onClick={() => setExpanded(true)}>
          +{hiddenCount} more
        </button>
      )}
      {expanded && list.length > AFFECTS_INLINE_LIMIT && (
        <button type="button" className="status-v3-pill__more" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

function AnnouncementCard({ item, timeZone }: { item: PublicAnnouncement; timeZone: string }) {
  const typeUpper = (item.type || 'INFO').toUpperCase();
  const badgeLabel = TYPE_LABEL[typeUpper] || item.type;
  const absolute = formatDateTime(item.startDate, timeZone, { format: 'short', hour12: true });
  const relative = formatDateTime(item.startDate, timeZone, { format: 'relative' });

  return (
    <div
      className={`status-v3-announcement-pill status-v3-announcement-pill--${typeUpper.toLowerCase()}`}
      role="listitem"
    >
      <div className="status-v3-announcement-pill__head">
        <div className="status-v3-announcement-pill__lead">
          <AnnouncementIcon type={typeUpper} />
          <span className="status-v3-announcement-pill__title">{item.title}</span>
          <span className="status-v3-announcement-pill__divider" aria-hidden="true" />
          <span className="status-v3-announcement-pill__time" suppressHydrationWarning title={absolute}>
            {relative}
          </span>
        </div>
        <div className="status-v3-announcement-pill__status">
          <StatusBadge status={typeUpper} label={badgeLabel} size="xs" showDot />
        </div>
      </div>

      {item.message && <ClampedDesc text={item.message} className="status-v3-announcement-pill__desc" />}

      <AffectsChips services={item.affectedServices} regions={item.affectedRegions} />
    </div>
  );
}

const MemoAnnouncementCard = memo(AnnouncementCard);

function ChangelogCard({ item, timeZone }: { item: PublicChangelogEntry; timeZone: string }) {
  const absolute = formatDateTime(item.publishedAt, timeZone, { format: 'short', hour12: true });
  const relative = formatDateTime(item.publishedAt, timeZone, { format: 'relative' });

  return (
    <div className="status-v3-changelog-pill" role="listitem">
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
          <span className="status-v3-changelog-pill__time" suppressHydrationWarning title={absolute}>
            {relative}
          </span>
        </div>
      </div>
      {item.message && <ClampedDesc text={item.message} className="status-v3-changelog-pill__desc" />}
      <ChangelogAffects services={item.affectedServices} />
    </div>
  );
}

const MemoChangelogCard = memo(ChangelogCard);

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
          <span className="status-v3-announcements-inline__subtitle">Recent changes & releases</span>
        </div>
        <div className="status-v3-announcements-inline__tally" aria-label={`${recent.length} changelog entries`}>
          <span className="status-v3-announcements-inline__tally-pill status-v3-announcements-inline__tally-pill--changelog">
            <span className="status-v3-announcements-inline__dot" aria-hidden="true" />
            {recent.length} {recent.length === 1 ? 'update' : 'updates'}
          </span>
        </div>
      </div>
      <div className="status-v3-changelog-inline__list" role="list">
        {recent.map(item => (
          <MemoChangelogCard key={item.id} item={item} timeZone={timeZone} />
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
        <section className="status-v3-announcements-inline" aria-labelledby="status-v3-announcements-heading">
          <div className="status-v3-announcements-inline__head">
            <div className="status-v3-announcements-inline__title-wrap">
              <h2 id="status-v3-announcements-heading" className="status-v3-announcements-inline__title">
                Announcements
              </h2>
              <span className="status-v3-announcements-inline__subtitle">Updates & notices</span>
            </div>
            <div className="status-v3-announcements-inline__tally" aria-label={`${announcements.length} announcements`}>
              <span className="status-v3-announcements-inline__tally-pill">
                <span className="status-v3-announcements-inline__dot" aria-hidden="true" />
                {announcements.length} {announcements.length === 1 ? 'announcement' : 'announcements'}
              </span>
            </div>
          </div>

          <div className="status-v3-announcements-inline__list" role="list">
            {announcements.map(item => (
              <MemoAnnouncementCard key={item.id} item={item} timeZone={timeZone} />
            ))}
          </div>
        </section>
      )}

      {hasChangelog && <ChangelogV3 changelog={changelog} timeZone={timeZone} />}
    </>
  );
}

const AnnouncementsV3 = memo(AnnouncementsV3Inner);
export default AnnouncementsV3;

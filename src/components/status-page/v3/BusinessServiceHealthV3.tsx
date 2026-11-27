'use client';

import { memo, useId, type ReactNode } from 'react';
import type {
  PublicBusinessService,
  PublicStatusService,
} from '@/lib/status-pages/public-contract';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';
import { formatDateTime } from '@/lib/timezone';
import { useT } from '@/lib/status-pages/i18n/context';
import { STATUS_LABEL_KEYS, type Translator } from '@/lib/status-pages/i18n';
import ServiceHistoryV3 from './ServiceHistoryV3';

type RowDisplay = {
  timeZone: string;
  showMetrics: boolean;
  showUptimeHistory: boolean;
  showSlaMetrics: boolean;
  /** Called with the group id; renders a 'Subscribe to this group' action when set. */
  onSubscribeGroup?: (id: string) => void;
  /** Where the active-incident chip on a group row points; plain text when unset. */
  incidentsHref?: string;
};

/** The history component draws any row with a status, uptime and segments. */
function asHistoryRow(item: PublicBusinessService): PublicStatusService {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    activeIncidentCount: item.activeIncidentCount,
    ...(item.statusSince ? { statusSince: item.statusSince } : {}),
    ...(item.uptime ? { uptime: item.uptime } : {}),
    ...(item.history ? { history: item.history } : {}),
  };
}

function serviceCountText(count: number, t: Translator) {
  return count === 1 ? t('business.serviceOne', { count }) : t('business.serviceCount', { count });
}

function tallyText(item: PublicBusinessService, t: Translator) {
  // memberServiceIds is emptied for groups that hide their members; memberCount is not.
  const total = item.memberCount ?? item.memberServiceIds.length;
  return item.impactedServiceCount > 0
    ? t(total === 1 ? 'business.affectedOne' : 'business.affectedCount', {
        impacted: item.impactedServiceCount,
        total,
      })
    : serviceCountText(total, t);
}

const BusinessIcon = () => (
  <svg
    className="status-v3-service__icon"
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
    <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
    <path d="m7 16.5-4.74-2.85" />
    <path d="m7 16.5 5-3" />
    <path d="M7 16.5v5.17" />
    <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
    <path d="m17 16.5-5-3" />
    <path d="m17 16.5 4.74-2.85" />
    <path d="M17 16.5v5.17" />
    <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
    <path d="M12 8 7.26 5.15" />
    <path d="m12 8 4.74-2.85" />
    <path d="M12 13.5V8" />
  </svg>
);

const MemberRow = memo(function MemberRow({
  service,
  display,
}: {
  service: PublicStatusService;
  display: RowDisplay;
}) {
  const t = useT();
  const presentation = statusPresentation(service.status);
  const affected = service.status !== 'OPERATIONAL';
  return (
    <div
      role="listitem"
      className={`status-v3-business__member${affected ? ' status-v3-business__member--affected' : ''}`}
      data-status={presentation.token}
    >
      <div className="status-v3-service__head">
        <span className="status-v3-business__member-name">{service.name}</span>
        <StatusBadge
          status={service.status}
          label={t(STATUS_LABEL_KEYS[service.status])}
          size="xs"
          showDot
        />
      </div>
      {service.description && <p className="status-v3-service__desc">{service.description}</p>}
      {((display.showUptimeHistory && service.history) ||
        (display.showMetrics && service.uptime)) && (
        <ServiceHistoryV3
          service={service}
          timeZone={display.timeZone}
          showGrade={false}
          showUptimeInline={display.showMetrics}
          showHistoryBars={display.showUptimeHistory}
          // Members stay compact: their bars and headline uptime, without the 30/90-day ledger.
          showSlaMetrics={false}
        />
      )}
    </div>
  );
});

/**
 * One business service: worst member status, merged history and uptime. Expandable rows are a
 * disclosure (button with aria-expanded/aria-controls) revealing each member's own row.
 */
export const BusinessServiceRowV3 = memo(function BusinessServiceRowV3({
  item,
  members,
  expandable,
  open,
  onToggle,
  display,
  childRows,
  childCount = 0,
  level = 1,
}: {
  item: PublicBusinessService;
  members: PublicStatusService[];
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  display: RowDisplay;
  /** Nested child business-service rows (already rendered), shown under this row. */
  childRows?: ReactNode;
  childCount?: number;
  /** 1-based depth in the support hierarchy, exposed as aria-level. */
  level?: number;
}) {
  const t = useT();
  const panelId = useId();
  const presentation = statusPresentation(item.status);
  const affected = item.status !== 'OPERATIONAL';
  const row = asHistoryRow(item);
  // Members stay out of view when the page shows only the business service.
  const showMembers = item.showMembers !== false;
  const canExpand = expandable && (showMembers || childCount > 0);
  const tally = (
    <span
      className={`status-v3-business__tally${item.impactedServiceCount > 0 ? ' status-v3-business__tally--impacted' : ''}`}
    >
      {tallyText(item, t)}
    </span>
  );
  const incidentText = t(
    item.activeIncidentCount === 1 ? 'business.incidentOne' : 'business.incidentCount',
    { count: item.activeIncidentCount }
  );
  // Without disclosure (non-expandable layout) children are always visible.
  const showChildren = childCount > 0 && (!expandable || open);
  return (
    <div
      role="listitem"
      aria-level={level}
      className={`status-v3-service status-service-card status-v3-business${level > 1 ? ' status-v3-business--child' : ''}${affected ? ' status-v3-service--affected' : ''}`}
      data-status={presentation.token}
      data-expanded={canExpand ? String(open) : undefined}
    >
      <div className="status-v3-service__head">
        <div className="status-v3-service__lead">
          <BusinessIcon />
          <span className="status-v3-service__name">{item.name}</span>
          {tally}
          {item.activeIncidentCount > 0 &&
            (display.incidentsHref ? (
              <a
                className="status-v3-chip"
                href={display.incidentsHref}
                style={{ textDecoration: 'none' }}
              >
                {incidentText}
              </a>
            ) : (
              <span className="status-v3-chip">{incidentText}</span>
            ))}
        </div>
        <div className="status-v3-service__badges">
          {display.onSubscribeGroup && (
            <button
              type="button"
              className="status-v3-business__subscribe"
              onClick={() => display.onSubscribeGroup?.(item.id)}
              aria-label={t('business.subscribeTo', { name: item.name })}
            >
              {t('business.subscribe')}
            </button>
          )}
          <StatusBadge
            status={item.status}
            label={t(STATUS_LABEL_KEYS[item.status])}
            size="sm"
            showDot
            pulse={affected}
          />
        </div>
      </div>

      {item.description && <p className="status-v3-service__desc">{item.description}</p>}
      {affected && item.statusSince && (
        <p className="status-v3-service__desc" suppressHydrationWarning>
          {(() => {
            const [before, after] = t('business.since', {
              status: t(STATUS_LABEL_KEYS[item.status]),
              time: '\u0000',
            }).split('\u0000');
            return (
              <>
                {before}
                <time dateTime={item.statusSince}>
                  {formatDateTime(item.statusSince, display.timeZone, {
                    format: 'short',
                    hour12: true,
                  })}
                </time>
                {after}
              </>
            );
          })()}
        </p>
      )}

      {((display.showUptimeHistory && item.history) || (display.showMetrics && item.uptime)) && (
        <ServiceHistoryV3
          service={row}
          timeZone={display.timeZone}
          showGrade={false}
          showUptimeInline={display.showMetrics}
          showHistoryBars={display.showUptimeHistory}
          showSlaMetrics={display.showSlaMetrics}
          incidentServiceIds={item.memberServiceIds}
          businessServiceId={item.id}
        />
      )}

      {canExpand && (
        // A full-width bar under the history, so the disclosure reads as a control, not a tiny chevron.
        <button
          type="button"
          className="status-v3-business__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          // Starts with the visible label (label-in-name) and adds which group it opens.
          aria-label={`${open ? t('business.hideServices') : t('business.showServices')}, ${item.name}${childCount > 0 ? `, ${t('business.nested', { count: childCount })}` : ''}`}
          onClick={onToggle}
        >
          <span className="status-v3-business__toggle-label">
            {open ? t('business.hideServices') : t('business.showServices')}
          </span>
          <svg
            className="status-v3-business__chevron"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      {canExpand && (
        <div
          id={panelId}
          className="status-v3-business__members"
          role="list"
          aria-label={t('business.servicesIn', { name: item.name })}
          hidden={!open}
        >
          {open &&
            showMembers &&
            members.map(member => <MemberRow key={member.id} service={member} display={display} />)}
        </div>
      )}
      {showChildren && (
        <div
          role="list"
          aria-label={t('business.within', { name: item.name })}
          className="status-v3-business__children"
        >
          {childRows}
        </div>
      )}
    </div>
  );
});

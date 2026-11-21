'use client';

import { memo, useId } from 'react';
import type {
  PublicBusinessService,
  PublicStatusService,
} from '@/lib/status-pages/public-contract';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';
import ServiceHistoryV3 from './ServiceHistoryV3';

type RowDisplay = {
  timeZone: string;
  showMetrics: boolean;
  showUptimeHistory: boolean;
  showSlaMetrics: boolean;
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

function tallyText(item: PublicBusinessService) {
  const total = item.memberServiceIds.length;
  const noun = total === 1 ? 'service' : 'services';
  return item.impactedServiceCount > 0
    ? `${item.impactedServiceCount} of ${total} ${noun} affected`
    : `${total} ${noun}`;
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
        <StatusBadge status={service.status} label={presentation.label} size="xs" showDot />
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
}: {
  item: PublicBusinessService;
  members: PublicStatusService[];
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  display: RowDisplay;
}) {
  const panelId = useId();
  const presentation = statusPresentation(item.status);
  const affected = item.status !== 'OPERATIONAL';
  const row = asHistoryRow(item);
  return (
    <div
      role="listitem"
      className={`status-v3-service status-service-card status-v3-business${affected ? ' status-v3-service--affected' : ''}`}
      data-status={presentation.token}
      data-expanded={expandable ? String(open) : undefined}
    >
      <div className="status-v3-service__head">
        <div className="status-v3-service__lead">
          {expandable ? (
            <button
              type="button"
              className="status-v3-business__toggle"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
            >
              <svg
                className="status-v3-business__chevron"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <BusinessIcon />
              <span className="status-v3-service__name">{item.name}</span>
              <span className="sr-only">
                , {open ? 'hide' : 'show'} {members.length}{' '}
                {members.length === 1 ? 'service' : 'services'}
              </span>
            </button>
          ) : (
            <>
              <BusinessIcon />
              <span className="status-v3-service__name">{item.name}</span>
            </>
          )}
          <span
            className={`status-v3-business__tally${item.impactedServiceCount > 0 ? ' status-v3-business__tally--impacted' : ''}`}
          >
            {tallyText(item)}
          </span>
        </div>
        <div className="status-v3-service__badges">
          <StatusBadge
            status={item.status}
            label={presentation.label}
            size="sm"
            showDot
            pulse={affected}
          />
        </div>
      </div>

      {item.description && <p className="status-v3-service__desc">{item.description}</p>}

      {((display.showUptimeHistory && item.history) || (display.showMetrics && item.uptime)) && (
        <ServiceHistoryV3
          service={row}
          timeZone={display.timeZone}
          showGrade={false}
          showUptimeInline={display.showMetrics}
          showHistoryBars={display.showUptimeHistory}
          showSlaMetrics={display.showSlaMetrics}
        />
      )}

      {expandable && (
        <div
          id={panelId}
          className="status-v3-business__members"
          role="list"
          aria-label={`Services in ${item.name}`}
          hidden={!open}
        >
          {open && members.map(member => (
            <MemberRow key={member.id} service={member} display={display} />
          ))}
        </div>
      )}
    </div>
  );
});

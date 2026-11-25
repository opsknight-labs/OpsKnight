import type { PublicIncident, PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import {
  createTranslator,
  formatLocalizedDateTime,
  normalizeLocale,
} from '@/lib/status-pages/i18n';
import { incidentLinkId } from '@/lib/status-pages/incident-link';

const CSS = `
.sp-doc{max-inline-size:760px;margin:0 auto;padding:24px 16px;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a}
@media (prefers-color-scheme:dark){.sp-doc{color:#e2e8f0}.sp-doc a{color:#93c5fd}}
.sp-doc h1{font-size:1.5rem;margin:.25rem 0}
.sp-doc h2{font-size:1.05rem;margin:1.5rem 0 .5rem}
.sp-doc ol{list-style:none;margin:0;padding:0;border-inline-start:2px solid #cbd5e1}
.sp-doc ol li{padding:0 0 1rem 1rem}.sp-doc ul{margin:0;padding-inline-start:1.1rem}.sp-doc ul li{padding:0 0 .5rem}
.sp-doc__meta{color:#64748b;font-size:.875rem}
.sp-doc__nav{display:flex;justify-content:space-between;gap:12px;margin-block:1rem}
`;

type Props = { snapshot: PublicStatusPageSnapshot };

function Shell({ snapshot, children }: Props & { children: React.ReactNode }) {
  const locale = normalizeLocale(snapshot.page.presentation?.locale);
  return (
    <main className="sp-doc" lang={locale}>
      <style>{CSS}</style>
      {children}
    </main>
  );
}

export function StatusPageIncidentView({
  snapshot,
  incident,
  basePath,
}: Props & { incident: PublicIncident; basePath: string }) {
  const locale = normalizeLocale(snapshot.page.presentation?.locale);
  const t = createTranslator(locale);
  const when = (value?: string) =>
    value ? formatLocalizedDateTime(value, locale, 'UTC') + ' UTC' : null;
  const affected = [
    ...(incident.service?.name ? [incident.service.name] : []),
    ...(incident.businessServices ?? []).map(group => group.name),
  ];
  const pir =
    snapshot.page.showPostIncidentReview && incident.postmortem
      ? `${basePath}/postmortems/${encodeURIComponent(incident.postmortem.id)}`
      : null;
  return (
    <Shell snapshot={snapshot}>
      <a href={basePath}>{t('incident.back')}</a>
      <h1>{incident.title ?? t('incident.title')}</h1>
      <p className="sp-doc__meta">
        {incident.status}
        {incident.createdAt && (
          <>
            {' '}
            · {t('incident.started')} {when(incident.createdAt)}
          </>
        )}
        {incident.resolvedAt && (
          <>
            {' '}
            · {t('incident.resolved')} {when(incident.resolvedAt)}
          </>
        )}
      </p>
      {incident.description && <p>{incident.description}</p>}
      {affected.length > 0 && (
        <>
          <h2>{t('incident.affected')}</h2>
          <ul>
            {affected.map(name => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>
      )}
      <h2>{t('incident.timeline')}</h2>
      {incident.updates?.length ? (
        <ol>
          {incident.updates.map(update => (
            <li key={update.id}>
              <strong>{update.type}</strong>
              {update.createdAt && (
                <span className="sp-doc__meta"> · {when(update.createdAt)}</span>
              )}
              <div>{update.message}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sp-doc__meta">{t('incident.noUpdates')}</p>
      )}
      {pir && (
        <p>
          <a href={pir}>{t('incident.postmortem')}</a>
        </p>
      )}
    </Shell>
  );
}

export function StatusPageHistoryView({
  snapshot,
  incidents,
  month,
  basePath,
  prevMonth,
  nextMonth,
}: Props & {
  incidents: PublicIncident[];
  month: string;
  basePath: string;
  prevMonth: string | null;
  nextMonth: string | null;
}) {
  const locale = normalizeLocale(snapshot.page.presentation?.locale);
  const t = createTranslator(locale);
  const label = formatLocalizedDateTime(`${month}-01T00:00:00Z`, locale, 'UTC', {
    month: 'long',
    year: 'numeric',
  });
  return (
    <Shell snapshot={snapshot}>
      <a href={basePath}>{t('incident.back')}</a>
      <h1>
        {t('history.title')} · {label}
      </h1>
      <nav className="sp-doc__nav" aria-label={t('history.title')}>
        {prevMonth ? (
          <a href={`${basePath}/history?month=${prevMonth}`}>← {t('history.previous')}</a>
        ) : (
          <span />
        )}
        {nextMonth ? (
          <a href={`${basePath}/history?month=${nextMonth}`}>{t('history.next')} →</a>
        ) : (
          <span />
        )}
      </nav>
      {incidents.length === 0 ? (
        <p className="sp-doc__meta">{t('history.none')}</p>
      ) : (
        <ul>
          {incidents.map(incident => {
            const id = incidentLinkId(incident);
            const title = incident.title ?? t('incident.title');
            return (
              <li key={id ?? title + incident.createdAt}>
                {id ? (
                  <a href={`${basePath}/incidents/${encodeURIComponent(id)}`}>{title}</a>
                ) : (
                  title
                )}
                <span className="sp-doc__meta">
                  {' '}
                  ·{' '}
                  {incident.createdAt
                    ? formatLocalizedDateTime(incident.createdAt, locale, 'UTC')
                    : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

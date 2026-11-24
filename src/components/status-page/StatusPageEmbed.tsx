import type {
  PublicBusinessService,
  PublicStatusPageSnapshot,
} from '@/lib/status-pages/public-contract';
import { STATUS_LABEL_KEYS, createTranslator, normalizeLocale } from '@/lib/status-pages/i18n';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { getBaseUrl } from '@/lib/env-validation';

const DOT: Record<string, string> = {
  OPERATIONAL: '#16a34a',
  MAINTENANCE: '#2563eb',
  DEGRADED: '#d97706',
  PARTIAL_OUTAGE: '#ea580c',
  MAJOR_OUTAGE: '#dc2626',
  UNKNOWN: '#64748b',
};

const CSS = `
.sp-embed{--bg:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;margin:0;padding:12px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){.sp-embed{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b}}
.sp-embed *{box-sizing:border-box}
.sp-embed h1{font-size:15px;margin:0 0 2px}
.sp-embed__overall{display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.sp-embed__dot{inline-size:10px;block-size:10px;border-radius:50%;flex:none}
.sp-embed ul{list-style:none;margin:0;padding:0}
.sp-embed li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)}
.sp-embed ul ul{margin-inline-start:14px}
.sp-embed__name{min-inline-size:0;overflow-wrap:anywhere}
.sp-embed__status{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;white-space:nowrap}
.sp-embed__foot{display:flex;justify-content:space-between;gap:8px;padding-top:8px;font-size:12px;color:var(--muted)}
.sp-embed a{color:inherit}
`;

function Row({
  name,
  status,
  t,
}: {
  name: string;
  status: string;
  t: ReturnType<typeof createTranslator>;
}) {
  const label = t(STATUS_LABEL_KEYS[status as keyof typeof STATUS_LABEL_KEYS] ?? 'status.unknown');
  return (
    <>
      <span className="sp-embed__name">{name}</span>
      <span className="sp-embed__status">
        <span
          className="sp-embed__dot"
          style={{ background: DOT[status] ?? DOT.UNKNOWN }}
          aria-hidden="true"
        />
        {label}
      </span>
    </>
  );
}

/** Compact, chrome-free status widget for iframes. Reads only the published snapshot. */
export default function StatusPageEmbed({ snapshot }: { snapshot: PublicStatusPageSnapshot }) {
  const page = snapshot.page;
  const locale = normalizeLocale(page.presentation?.locale);
  const t = createTranslator(locale);
  const showServices = page.visibility?.services !== false;
  const groups = showServices ? (snapshot.businessServices ?? []) : [];
  const grouped = new Set(groups.flatMap(group => group.memberServiceIds));
  const roots = groups.filter(
    group => !group.parentId || !groups.some(g => g.id === group.parentId)
  );
  const children = (id: string) => groups.filter(group => group.parentId === id);
  const ungrouped = showServices ? snapshot.services.filter(s => !grouped.has(s.id)) : [];
  const showMembers = (group: PublicBusinessService) => group.showMembers !== false;
  const byId = new Map(snapshot.services.map(service => [service.id, service]));

  const renderGroup = (group: PublicBusinessService, depth: number): React.ReactNode => (
    <li key={group.id} style={{ display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Row name={group.name} status={group.status} t={t} />
      </div>
      {showMembers(group) && (
        <ul>
          {group.memberServiceIds.flatMap(id => {
            const service = byId.get(id);
            return service
              ? [
                  <li key={id}>
                    <Row name={service.name} status={service.status} t={t} />
                  </li>,
                ]
              : [];
          })}
        </ul>
      )}
      {depth < 3 && children(group.id).length > 0 && (
        <ul>{children(group.id).map(child => renderGroup(child, depth + 1))}</ul>
      )}
    </li>
  );

  return (
    <main className="sp-embed" lang={locale}>
      <style>{CSS}</style>
      <div className="sp-embed__overall">
        <span
          className="sp-embed__dot"
          style={{ background: DOT[snapshot.status] ?? DOT.UNKNOWN }}
          aria-hidden="true"
        />
        <div>
          <h1>{page.name}</h1>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {snapshot.status === 'OPERATIONAL'
              ? t('embed.allOperational')
              : t(STATUS_LABEL_KEYS[snapshot.status])}
          </div>
        </div>
      </div>
      {(roots.length > 0 || ungrouped.length > 0) && (
        <ul aria-label={t('hero.services')}>
          {roots.map(group => renderGroup(group, 1))}
          {ungrouped.map(service => (
            <li key={service.id}>
              <Row name={service.name} status={service.status} t={t} />
            </li>
          ))}
        </ul>
      )}
      <div className="sp-embed__foot">
        <a
          href={getStatusPagePublicUrl(page, getBaseUrl())}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('embed.viewFull')}
        </a>
        <span>{t('common.poweredBy')}</span>
      </div>
    </main>
  );
}

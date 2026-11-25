import type { PublicServiceStatus } from '@/lib/status-pages/public-contract';

const COLORS: Record<PublicServiceStatus, { label: string; color: string }> = {
  OPERATIONAL: { label: 'operational', color: '#047857' },
  MAINTENANCE: { label: 'maintenance', color: '#1d4ed8' },
  DEGRADED: { label: 'degraded', color: '#b45309' },
  PARTIAL_OUTAGE: { label: 'partial outage', color: '#c2410c' },
  MAJOR_OUTAGE: { label: 'major outage', color: '#be123c' },
  UNKNOWN: { label: 'unknown', color: '#475569' },
};

const escapeXml = (value: string) => value.replace(/[<>&"']/g, ch => `&#${ch.charCodeAt(0)};`);

// Approximate Verdana 11px advance; precise enough for a badge and needs no font metrics.
const textWidth = (text: string) => Math.ceil(text.length * 6.4) + 12;

/** Shields-style two-part overall-status badge. `title` is the page name, XML-escaped. */
export function buildStatusBadge(title: string, status: PublicServiceStatus): string {
  // eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input
  const { label, color } = COLORS[status] ?? COLORS.UNKNOWN;
  const left = escapeXml(title.slice(0, 40));
  const lw = textWidth(title.slice(0, 40));
  const rw = textWidth(label);
  const aria = escapeXml(`${title.slice(0, 40)}: ${label}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${aria}"><title>${aria}</title><clipPath id="r"><rect width="${lw + rw}" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#475569"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${left}</text><text x="${lw + rw / 2}" y="14">${label}</text></g></svg>`;
}

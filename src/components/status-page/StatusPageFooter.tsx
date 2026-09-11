'use client';

interface StatusPageFooterProps {
  footerText?: string | null;
  links: {
    resources: Array<{ href: string; label: string }>;
    support: Array<{ href: string; label: string }>;
  };
}

function RssIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="M4 11a9 9 0 0 1 9 9" strokeLinecap="round" />
      <path d="M4 4a16 16 0 0 1 16 16" strokeLinecap="round" />
      <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ApiIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <polyline points="16 18 22 12 16 6" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="8 6 2 12 8 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="16" y1="13" x2="8" y2="13" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="16" y1="17" x2="8" y2="17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" strokeLinecap="round" strokeLinejoin="round" />
      <line
        x1="14.83"
        y1="14.83"
        x2="19.07"
        y2="19.07"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="14.83"
        y1="9.17"
        x2="19.07"
        y2="4.93"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="4.93"
        y1="19.07"
        x2="9.17"
        y2="14.83"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2" />
      <path d="M4.2 6.6 12 12.4l7.8-5.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      aria-hidden="true"
    >
      <line x1="7" y1="17" x2="17" y2="7" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 7 17 7 17 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getLinkIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes('rss') || l.includes('feed')) return <RssIcon />;
  if (l.includes('api') || l.includes('json')) return <ApiIcon />;
  if (l.includes('csv') || l.includes('pdf') || l.includes('uptime')) return <FileIcon />;
  if (l.includes('contact') || l.includes('email') || l.includes('mail')) return <MailIcon />;
  return <SupportIcon />;
}

export default function StatusPageFooter({ footerText, links }: StatusPageFooterProps) {
  const currentYear = new Date().getFullYear();
  const hasResources = Boolean(links?.resources && links.resources.length > 0);
  const hasSupport = Boolean(links?.support && links.support.length > 0);
  const hasAnyLinks = hasResources || hasSupport;

  return (
    <footer className="status-site-footer">
      <div className="status-site-footer__inner">
        <div className="status-site-footer__main">
          <div className="status-site-footer__info">
            <div className="status-site-footer__status-indicator">
              <span className="status-site-footer__pulse-dot" aria-hidden="true" />
              <span>Real-Time Incident &amp; Telemetry Updates</span>
            </div>
            <p className="status-site-footer__text">
              {footerText || 'Status, incident communication, and real-time availability tracking.'}
            </p>
          </div>

          {hasAnyLinks && (
            <div className="status-site-footer__nav-wrap">
              {hasResources && (
                <nav
                  className="status-site-footer__pill-group"
                  aria-label="Status feeds and exports"
                >
                  <span className="status-site-footer__group-label">Feeds &amp; API</span>
                  <div className="status-site-footer__pill-row">
                    {links.resources.map(link => (
                      <a key={link.href} className="status-site-footer__pill" href={link.href}>
                        <span className="status-site-footer__pill-icon" aria-hidden="true">
                          {getLinkIcon(link.label)}
                        </span>
                        <span>{link.label}</span>
                      </a>
                    ))}
                  </div>
                </nav>
              )}

              {hasSupport && (
                <nav className="status-site-footer__pill-group" aria-label="Support and contact">
                  <span className="status-site-footer__group-label">Support</span>
                  <div className="status-site-footer__pill-row">
                    {links.support.map(link => (
                      <a key={link.href} className="status-site-footer__pill" href={link.href}>
                        <span className="status-site-footer__pill-icon" aria-hidden="true">
                          {getLinkIcon(link.label)}
                        </span>
                        <span>{link.label}</span>
                      </a>
                    ))}
                  </div>
                </nav>
              )}
            </div>
          )}
        </div>

        <div className="status-site-footer__bottom">
          <div className="status-site-footer__copyright">
            <span>&copy; {currentYear} All systems operational</span>
            <span className="status-site-footer__dot-sep" aria-hidden="true">
              &bull;
            </span>
            <span>Incident history updated continuously</span>
          </div>

          <a
            className="status-site-footer__powered"
            href="https://opsknight.com/?ref=status_page"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Powered by OpsKnight — Incident Response and Status Pages"
          >
            <span className="status-site-footer__powered-lead">Powered by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt=""
              width={18}
              height={18}
              className="status-site-footer__powered-logo"
              loading="lazy"
              decoding="async"
              onError={e => {
                const target = e.target as HTMLImageElement;
                if (!target.src.endsWith('/logo.png')) {
                  target.src = '/logo.png';
                }
              }}
            />
            <span className="status-site-footer__powered-brand">OpsKnight</span>
            <span className="status-site-footer__powered-cta">
              Create your status page
              <ArrowUpRightIcon />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function StatusPageFooter({
  footerText,
  links,
}: {
  footerText?: string | null;
  links: {
    resources: Array<{ href: string; label: string }>;
    support: Array<{ href: string; label: string }>;
  };
}) {
  return (
    <footer className="status-site-footer">
      <div className="status-site-footer__inner">
        <div className="status-site-footer__grid">
          <div className="status-site-footer__brand">
            <a className="status-site-footer__logo" href="https://opsknight.com/">
              OpsKnight
            </a>
            <p>{footerText || 'Status and incident communication for modern operations teams.'}</p>
          </div>
          {links.resources.length > 0 && (
            <nav aria-label="Status resources">
              <h2>Resources</h2>
              {links.resources.map(link => (
                <a key={link.href} className="status-footer-link" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          {links.support.length > 0 && (
            <nav aria-label="Support">
              <h2>Support</h2>
              {links.support.map(link => (
                <a key={link.href} className="status-footer-link" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          <nav aria-label="OpsKnight">
            <h2>Company</h2>
            <a className="status-footer-link" href="https://opsknight.com/">
              OpsKnight
            </a>
            <a className="status-footer-link" href="https://opsknight.com/">
              Status
            </a>
          </nav>
        </div>
        <p className="status-site-footer__legal">
          <span>Powered by </span>
          <a className="status-footer-link" href="https://opsknight.com/">
            OpsKnight
          </a>
        </p>
      </div>
    </footer>
  );
}

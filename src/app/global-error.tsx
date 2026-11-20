'use client';

import { useEffect } from 'react';

// global-error renders its own <html>, outside the app's CSS and theme providers,
// so it carries a tiny self-contained stylesheet that follows the OS colour scheme.
const css = `
.ge{--bg:#fff;--fg:#0f172a;--muted:#64748b;--border:#e2e8f0;--accent:#0f172a;--accent-fg:#fff}
@media (prefers-color-scheme:dark){.ge{--bg:#0b1020;--fg:#f1f5f9;--muted:#94a3b8;--border:#273449;--accent:#f1f5f9;--accent-fg:#0b1020}}
.ge{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ge section{width:min(100%,460px);text-align:center}
.ge h1{font-size:1.5rem;margin:0 0 .5rem}
.ge p{color:var(--muted);line-height:1.6;margin:0 0 1rem}
.ge .row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:1rem}
.ge button,.ge a.btn{min-height:44px;padding:0 16px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--fg);font:inherit;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
.ge button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.ge button:focus-visible,.ge a:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.ge .ref{font-family:ui-monospace,monospace;font-size:.8125rem}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('OpsKnight client runtime error', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="ge">
        <style>{css}</style>
        <section role="alert" aria-live="assertive">
          <h1>OpsKnight needs to recover this view.</h1>
          <p>Something went wrong while loading this page. Retrying usually fixes it.</p>
          <div className="row">
            <button type="button" className="primary" onClick={reset}>
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            >
              Reload page
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload is intended after a fatal error */}
            <a className="btn" href="/">
              Dashboard
            </a>
          </div>
          {error.digest ? (
            <p className="ref" style={{ marginTop: 16 }}>
              Correlation ID: {error.digest}
            </p>
          ) : null}
        </section>
      </body>
    </html>
  );
}

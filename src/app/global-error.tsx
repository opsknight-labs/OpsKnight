'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('OpsKnight client runtime error', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section role="alert" aria-live="assertive" style={{ width: 'min(100%, 460px)' }}>
            <h1>OpsKnight needs to recover this view.</h1>
            <p>The current UI state could not be reconciled safely. Retry the render first.</p>
            <button type="button" onClick={reset} style={{ minHeight: 44, padding: '0 16px' }}>
              Retry
            </button>
            {error.digest ? <p>Correlation ID: {error.digest}</p> : null}
          </section>
        </main>
      </body>
    </html>
  );
}

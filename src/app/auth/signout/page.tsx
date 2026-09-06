import { Suspense } from 'react';
import SignOutClient from './signout-client';

export default function SignOutPage() {
  return (
    <Suspense
      fallback={
        <main className="login-shell" role="main">
          <div className="login-bg-animation">
            <div className="login-bg-orb login-bg-orb-1"></div>
            <div className="login-bg-orb login-bg-orb-2"></div>
            <div className="login-bg-orb login-bg-orb-3"></div>
          </div>

          <div
            className="login-card glass-panel"
            style={{
              maxWidth: '480px',
              margin: 'auto',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 'auto',
              gridTemplateColumns: 'none',
              background: 'rgba(255, 255, 255, 0.7)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            }}
          >
            <section
              className="login-form"
              style={{
                width: '100%',
                padding: '3rem 2rem',
                background: 'transparent',
                boxShadow: 'none',
                textAlign: 'center',
              }}
            >
              <div
                className="login-form-logo"
                style={{ margin: '0 auto 1.5rem', width: '56px', height: '56px' }}
              >
                <img
                  src="/logo.svg"
                  alt="OpsKnight"
                  className="login-form-logo-img"
                  style={{ width: '32px', height: '32px' }}
                />
              </div>

              <h1
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  marginBottom: '0.75rem',
                }}
              >
                Sign Out
              </h1>

              <p
                style={{
                  color: 'var(--text-secondary)',
                  marginBottom: '2rem',
                  fontSize: '1rem',
                }}
              >
                Loading…
              </p>
            </section>
          </div>
        </main>
      }
    >
      <SignOutClient />
    </Suspense>
  );
}

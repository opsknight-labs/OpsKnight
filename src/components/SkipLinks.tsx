'use client';

export default function SkipLinks() {
  return (
    <>
      <a
        href="#main-content"
        style={{
          position: 'absolute',
          top: '-40px',
          left: '0',
          background: 'var(--primary-color)',
          color: 'white',
          padding: '0.5rem 1rem',
          textDecoration: 'none',
          borderRadius: '0 0 var(--radius-sm) 0',
          zIndex: 10000,
          fontSize: '0.875rem',
          fontWeight: '600',
        }}
        onFocus={e => {
          e.currentTarget.style.top = '0';
        }}
        onBlur={e => {
          e.currentTarget.style.top = '-40px';
        }}
      >
        Skip to main content
      </a>
      <a
        href="#navigation"
        style={{
          position: 'absolute',
          top: '-40px',
          left: '120px',
          background: 'var(--primary-color)',
          color: 'white',
          padding: '0.5rem 1rem',
          textDecoration: 'none',
          borderRadius: '0 0 var(--radius-sm) 0',
          zIndex: 10000,
          fontSize: '0.875rem',
          fontWeight: '600',
        }}
        onFocus={e => {
          e.currentTarget.style.top = '0';
        }}
        onBlur={e => {
          e.currentTarget.style.top = '-40px';
        }}
      >
        Skip to navigation
      </a>
    </>
  );
}

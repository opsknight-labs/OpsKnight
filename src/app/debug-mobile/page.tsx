'use client';

import { useEffect, useState } from 'react';

export default function DebugPage() {
  const [userAgent, setUserAgent] = useState('Loading...');
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [cookies, setCookies] = useState<string[]>([]);

  useEffect(() => {
    setUserAgent(navigator.userAgent);
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(
        navigator.userAgent
      );
    setIsMobile(mobile);
    setCurrentPath(window.location.pathname);
    setCookies(
      document.cookie
        .split(';')
        .map(c => c.trim())
        .filter(Boolean)
    );
  }, []);

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1rem' }}>Mobile Detection Debug</h1>

      <div style={{ marginBottom: '1.5rem' }}>
        <strong>User-Agent:</strong>
        <div
          style={{
            padding: '1rem',
            background: '#f0f0f0',
            borderRadius: '8px',
            marginTop: '0.5rem',
            wordBreak: 'break-all',
            fontSize: '0.9rem',
          }}
        >
          {userAgent}
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <strong>Is Mobile Detected:</strong>
        <span
          style={{
            marginLeft: '0.5rem',
            padding: '0.25rem 0.75rem',
            borderRadius: '4px',
            background: isMobile ? '#d1fae5' : '#fee2e2',
            color: isMobile ? '#065f46' : '#991b1b',
            fontWeight: 'bold',
          }}
        >
          {isMobile === null ? '...' : isMobile ? 'YES ✓' : 'NO ✗'}
        </span>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <strong>Current Path:</strong> {currentPath || 'Loading...'}
      </div>

      <div>
        <strong>Cookies:</strong>
        <div
          style={{
            padding: '1rem',
            background: '#f0f0f0',
            borderRadius: '8px',
            marginTop: '0.5rem',
            fontSize: '0.9rem',
          }}
        >
          {cookies.length > 0 ? (
            cookies.map((cookie, i) => <div key={i}>{cookie}</div>)
          ) : (
            <em>No cookies found</em>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: '#e0f2fe',
          borderRadius: '8px',
          fontSize: '0.9rem',
        }}
      >
        <strong>💡 Tip:</strong> If you're on mobile but it shows "NO", try clearing your browser
        cache and cookies, then revisit this page.
      </div>
    </div>
  );
}

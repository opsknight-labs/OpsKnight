'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type RealTimeUpdatesProps = {
  autoRefreshInterval?: number; // in seconds
};

export default function DashboardRealTimeUpdates({
  autoRefreshInterval = 60,
}: RealTimeUpdatesProps) {
  const router = useRouter();
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('dashboard-auto-refresh');
    if (saved !== null) {
      setIsEnabled(saved === 'true'); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, []);

  useEffect(() => {
    if (!isEnabled) return;

    const interval = setInterval(() => {
      setIsRefreshing(true);
      router.refresh();
      setLastUpdate(new Date());
      setTimeout(() => setIsRefreshing(false), 1000);
    }, autoRefreshInterval * 1000);

    return () => clearInterval(interval);
  }, [router, autoRefreshInterval, isEnabled]);

  const toggleAutoRefresh = () => {
    const newValue = !isEnabled;
    setIsEnabled(newValue);
    localStorage.setItem('dashboard-auto-refresh', String(newValue));
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        background: 'white',
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.85rem',
        zIndex: 1000,
      }}
    >
      {isRefreshing && (
        <div
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            border: '2px solid var(--primary-color)',
            borderTopColor: 'transparent',
            animation: 'spin 1s linear infinite',
          }}
        />
      )}
      <div style={{ color: 'var(--text-muted)' }}>
        {isRefreshing ? 'Updating...' : `Updated ${formatTimeAgo(lastUpdate)}`}
      </div>
      <button
        onClick={toggleAutoRefresh}
        style={{
          padding: '0.25rem 0.5rem',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          background: isEnabled ? 'var(--primary-color)' : 'white',
          color: isEnabled ? 'white' : 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: '600',
        }}
        title={isEnabled ? 'Disable auto-refresh' : 'Enable auto-refresh'}
      >
        {isEnabled ? 'ON' : 'OFF'}
      </button>
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

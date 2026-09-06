'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import MobileCard from '@/components/mobile/MobileCard';
import { haptics } from '@/lib/haptics';

export default function MobileThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return (
      <MobileCard variant="default" padding="md">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '28px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <span className="mobile-menu-icon">🎨</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Appearance</span>
          </div>
          <div
            style={{
              width: '52px',
              height: '28px',
              background: 'var(--bg-secondary)',
              borderRadius: '14px',
            }}
          />
        </div>
      </MobileCard>
    );
  }

  // Use resolvedTheme for actual dark/light detection (handles 'system' correctly)
  const isDark = resolvedTheme === 'dark';
  const isSystemTheme = theme === 'system';

  const handleToggle = () => {
    haptics.impact('light');
    if (isDark) {
      setTheme('light');
    } else {
      setTheme('dark');
    }
  };

  const handleSystemReset = () => {
    setTheme('system');
  };

  return (
    <MobileCard variant="default" padding="md">
      <div
        role="switch"
        aria-checked={isDark}
        aria-label="Toggle dark mode"
        tabIndex={0}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={handleToggle}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <span className="mobile-menu-icon">{isDark ? '🌙' : '☀️'}</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {isDark ? 'Dark Mode' : 'Light Mode'}
            </div>
            {!isSystemTheme && (
              <button
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleSystemReset();
                }}
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--primary-color)',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  marginTop: '2px',
                }}
              >
                Reset to System
              </button>
            )}
          </div>
        </div>

        {/* iOS-style Toggle Switch */}
        <div
          style={{
            flexShrink: 0,
            width: '52px',
            height: '32px',
            background: isDark
              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
              : 'rgba(120, 120, 128, 0.16)',
            borderRadius: '16px',
            position: 'relative',
            transition: 'background 0.25s ease',
            boxShadow: isDark
              ? '0 2px 8px rgba(99, 102, 241, 0.3)'
              : 'inset 0 0 0 1px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              background: '#ffffff',
              borderRadius: '50%',
              position: 'absolute',
              top: '2px',
              left: isDark ? '22px' : '2px',
              transition: 'left 0.25s cubic-bezier(0.4, 0.0, 0.2, 1), box-shadow 0.25s ease',
              boxShadow: '0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Icon inside toggle */}
            <span
              style={{
                fontSize: '14px',
                transition: 'opacity 0.2s ease',
                opacity: 0.8,
              }}
            >
              {isDark ? '🌙' : '☀️'}
            </span>
          </div>
        </div>
      </div>
    </MobileCard>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatRelativeShort } from '@/lib/mobile-time';

interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  createdAt?: string;
  unread: boolean;
  type: 'incident' | 'service' | 'schedule';
  incidentId?: string;
}

/**
 * Mobile-optimized notification button with radar pulse animation
 * Fits the OpsKnight monitoring/sentinel theme
 */
export default function MobileNotificationButton() {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unreadCount = notifications.filter(n => n.unread).length;

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=5');
      if (res.ok) {
        const data = await res.json();
        const newNotifications = data.notifications || [];

        // Check if there are new notifications
        if (newNotifications.some((n: Notification) => n.unread)) {
          setHasNewNotification(true);
          if (pulseTimeoutRef.current) {
            clearTimeout(pulseTimeoutRef.current);
          }
          pulseTimeoutRef.current = setTimeout(() => setHasNewNotification(false), 3000);
        }

        setNotifications(newNotifications);
      }
    } catch {
      // Silent fail for notifications
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      fetchNotifications();
      interval = setInterval(fetchNotifications, 30000);
    };
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
        pulseTimeoutRef.current = null;
      }
    };
  }, [fetchNotifications]);

  // Close dropdown on outside interaction (touch + mouse)
  useEffect(() => {
    const handleOutside = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if ('PointerEvent' in window) {
      document.addEventListener('pointerdown', handleOutside, { passive: true });
      return () => document.removeEventListener('pointerdown', handleOutside);
    }

    document.addEventListener('touchstart', handleOutside, { passive: true });
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const handleNotificationClick = (notification: Notification) => {
    setIsOpen(false);
    if (notification.incidentId) {
      router.push(`/m/incidents/${notification.incidentId}`);
    }
  };

  const getNotificationTime = (notification: Notification) => {
    if (notification.createdAt) {
      return formatRelativeShort(notification.createdAt, userTimeZone);
    }
    return notification.time;
  };

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications/read', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
    } catch {
      // Silent fail
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* CSS Animations */}
      <style>{`
                @keyframes radarPulse {
                    0% {
                        transform: scale(1);
                        opacity: 0.8;
                    }
                    100% {
                        transform: scale(2.2);
                        opacity: 0;
                    }
                }
                @keyframes iconPop {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                .notification-btn:active {
                    transform: scale(0.95);
                }
                .notification-dropdown {
                    animation: fadeIn 0.15s ease-out;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @media (prefers-reduced-motion: reduce) {
                    .notification-btn,
                    .notification-dropdown {
                        animation: none !important;
                    }
                }
            `}</style>

      {/* Notification Button */}
      <button
        className="notification-btn"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          background: isOpen ? 'var(--bg-secondary)' : 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'background 0.2s ease',
        }}
      >
        {/* Radar Pulse Rings - when there are unread notifications */}
        {unreadCount > 0 && (
          <>
            <span
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--primary-color)',
                animation: reduceMotion ? 'none' : 'radarPulse 1.5s ease-out infinite',
              }}
            />
            <span
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--primary-color)',
                animation: reduceMotion ? 'none' : 'radarPulse 1.5s ease-out infinite 0.5s',
              }}
            />
          </>
        )}

        {/* Main Icon Container */}
        <div
          style={{
            position: 'relative',
            animation: hasNewNotification && !reduceMotion ? 'iconPop 0.3s ease' : 'none',
          }}
        >
          {/* Radar/Signal Icon */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={unreadCount > 0 ? 'var(--primary-color)' : 'var(--text-muted)'}
            strokeWidth="2"
            style={{ transition: 'stroke 0.2s ease' }}
          >
            {/* Radar waves */}
            <path
              d="M4.5 8.5c3-3.4 6-3.4 9 0"
              strokeLinecap="round"
              opacity={unreadCount > 0 ? 1 : 0.5}
            />
            <path
              d="M7.5 12c1.5-1.7 3-1.7 4.5 0"
              strokeLinecap="round"
              opacity={unreadCount > 0 ? 1 : 0.6}
            />
            {/* Center dot */}
            <circle
              cx="10"
              cy="15"
              r="1.5"
              fill={unreadCount > 0 ? 'var(--primary-color)' : 'var(--text-muted)'}
              stroke="none"
            />
            {/* Bell silhouette */}
            <path d="M15 18H5a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
            <path
              d="M18 8a6 6 0 0 0-6-6v2a4 4 0 0 1 4 4"
              strokeLinecap="round"
              opacity={unreadCount > 0 ? 1 : 0.4}
            />
          </svg>

          {/* Badge Count */}
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-4px',
                right: '-6px',
                minWidth: '16px',
                height: '16px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
                color: 'white',
                fontSize: '0.65rem',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 4px',
                boxShadow: '0 2px 4px rgba(220, 38, 38, 0.4)',
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="notification-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '300px',
            maxHeight: '400px',
            background: 'var(--bg-surface)',
            borderRadius: '16px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            zIndex: 100,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--primary-color)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: '600',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}>
                  📡
                </span>
                No notifications yet
              </div>
            ) : (
              notifications.map(notification => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  style={{
                    padding: '0.875rem 1rem',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: notification.unread ? 'rgba(99, 102, 241, 0.05)' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                    }}
                  >
                    {notification.unread && (
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: 'var(--primary-color)',
                          marginTop: '6px',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: '600',
                          fontSize: '0.875rem',
                          color: 'var(--text-primary)',
                          marginBottom: '2px',
                        }}
                      >
                        {notification.title}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {notification.message}
                      </div>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                          opacity: 0.7,
                        }}
                      >
                        {getNotificationTime(notification)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            onClick={() => {
              setIsOpen(false);
              router.push('/m/notifications');
            }}
            style={{
              padding: '0.75rem',
              textAlign: 'center',
              borderTop: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--primary-color)',
              fontSize: '0.85rem',
              fontWeight: '600',
            }}
          >
            View All Notifications
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

export default function TopbarClock() {
    const { userTimeZone } = useTimezone();
    const [time, setTime] = useState(new Date());
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Mark as mounted to prevent hydration mismatch
        setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect

        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    // Don't render time until mounted to avoid hydration mismatch
    if (!mounted) {
        return (
            <div className="topbar-clock" title="">
                <div className="topbar-clock-time">
                    <span className="topbar-clock-hours">--</span>
                    <span className="topbar-clock-separator">:</span>
                    <span className="topbar-clock-minutes">--</span>
                    <span className="topbar-clock-seconds">--</span>
                </div>
                <div className="topbar-clock-date">--</div>
            </div>
        );
    }

    // Format time in user's timezone - extract hours, minutes, seconds
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: userTimeZone
    });
    const timeParts = timeFormatter.formatToParts(time);
    const hours = timeParts.find(p => p.type === 'hour')?.value.padStart(2, '0') || '00';
    const minutes = timeParts.find(p => p.type === 'minute')?.value.padStart(2, '0') || '00';
    const seconds = timeParts.find(p => p.type === 'second')?.value.padStart(2, '0') || '00';

    // Format date in user's timezone
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: userTimeZone
    });
    const dateStr = dateFormatter.format(time).toUpperCase();

    return (
        <div className="topbar-clock" title={`${dateStr} - ${hours}:${minutes}:${seconds}`}>
            <div className="topbar-clock-time">
                <span className="topbar-clock-hours">{hours}</span>
                <span className="topbar-clock-separator">:</span>
                <span className="topbar-clock-minutes">{minutes}</span>
                <span className="topbar-clock-seconds">{seconds}</span>
            </div>
            <div className="topbar-clock-date">{dateStr}</div>
        </div>
    );
}


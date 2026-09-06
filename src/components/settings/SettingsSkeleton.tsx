'use client';

export default function SettingsSkeleton() {
    return (
        <div className="settings-skeleton">
            <div className="settings-skeleton-header">
                <div className="skeleton-line large" />
                <div className="skeleton-line" />
            </div>
            <div className="settings-skeleton-card">
                <div className="skeleton-line medium" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
            </div>
            <div className="settings-skeleton-card">
                <div className="skeleton-line medium" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
            </div>
        </div>
    );
}

'use client';

type InfoCalloutProps = {
    type?: 'info' | 'warning' | 'success' | 'error';
    title?: string;
    children: React.ReactNode;
    className?: string;
};

export default function InfoCallout({
    type = 'info',
    title,
    children,
    className = ''
}: InfoCalloutProps) {
    const icons = {
        info: 'ℹ️',
        warning: '⚠️',
        success: '✓',
        error: '✗'
    };

    return (
        <div className={`info-callout info-callout-${type} ${className}`.trim()}>
            <div className="info-callout-icon">{icons[type]}</div>
            <div className="info-callout-content">
                {title && <h4 className="info-callout-title">{title}</h4>}
                <div className="info-callout-body">{children}</div>
            </div>
        </div>
    );
}

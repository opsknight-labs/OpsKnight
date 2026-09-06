import { memo } from 'react';

interface ChartCardProps {
    title: string;
    children: React.ReactNode;
    subtitle?: string;
    className?: string;
}

function ChartCard({ title, children, subtitle, className = '' }: ChartCardProps) {
    return (
        <div className={`analytics-chart-enhanced ${className}`}>
            <div className="chart-header">
                <div className="chart-title">{title}</div>
                {subtitle && <div className="chart-subtitle">{subtitle}</div>}
            </div>
            <div className="chart-content">{children}</div>
        </div>
    );
}

// Memoize ChartCard to prevent unnecessary re-renders in analytics dashboards
export default memo(ChartCard);


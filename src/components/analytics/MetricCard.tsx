import { memo } from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  trendIntent?: 'positive' | 'negative' | 'neutral';
  icon?: React.ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
  children?: React.ReactNode;
  tooltip?: string;
  href?: string;
}

function MetricCard({
  label,
  value,
  detail,
  trend,
  trendValue,
  trendIntent,
  icon,
  variant = 'default',
  className = '',
  children,
  tooltip,
  href,
}: MetricCardProps) {
  const variantClass = () => {
    if (variant === 'primary') return 'analytics-card-primary';
    if (variant === 'success') return 'analytics-card-success';
    if (variant === 'warning') return 'analytics-card-warning';
    if (variant === 'danger') return 'analytics-card-danger';
    return 'analytics-card-default';
  };

  const trendColor = (value: 'up' | 'down' | 'neutral') => {
    if (value === 'up') return 'analytics-trend-up';
    if (value === 'down') return 'analytics-trend-down';
    return 'analytics-trend-neutral';
  };

  const trendLabel = trend === 'up' ? 'UP' : trend === 'down' ? 'DOWN' : 'FLAT';
  const trendColorClass =
    trendIntent === 'positive'
      ? trendColor('up')
      : trendIntent === 'negative'
        ? trendColor('down')
        : trendIntent === 'neutral'
          ? trendColor('neutral')
          : trend
            ? trendColor(trend)
            : trendColor('neutral');

  return (
    <article
      className={`analytics-card-enhanced ${variantClass()} ${className} ${href ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-primary/50 transition-all' : ''}`}
    >
      {href ? (
        <a href={href} className="contents">
          <div className="analytics-card-header">
            {icon && <div className="analytics-card-icon">{icon}</div>}
            <span className="analytics-label">{label}</span>
            {tooltip && (
              <div className="analytics-info-icon-wrapper">
                <span className="analytics-info-icon" title={tooltip}>
                  i
                </span>
              </div>
            )}
          </div>
          <div className="analytics-card-body">
            <span className="analytics-value">{value}</span>
            {trend && trendValue && (
              <div className={`analytics-trend ${trendColorClass}`}>
                <span className="analytics-trend-icon">{trendLabel}</span>
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          <span className="analytics-detail">{detail}</span>
          {children}
        </a>
      ) : (
        <>
          <div className="analytics-card-header">
            {icon && <div className="analytics-card-icon">{icon}</div>}
            <span className="analytics-label">{label}</span>
            {tooltip && (
              <div className="analytics-info-icon-wrapper">
                <span className="analytics-info-icon" title={tooltip}>
                  i
                </span>
              </div>
            )}
          </div>
          <div className="analytics-card-body">
            <span className="analytics-value">{value}</span>
            {trend && trendValue && (
              <div className={`analytics-trend ${trendColorClass}`}>
                <span className="analytics-trend-icon">{trendLabel}</span>
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          <span className="analytics-detail">{detail}</span>
          {children}
        </>
      )}
    </article>
  );
}

// Memoize MetricCard to prevent unnecessary re-renders on dashboard
export default memo(MetricCard);

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
  const variantClasses = {
    default: 'analytics-card-default',
    primary: 'analytics-card-primary',
    success: 'analytics-card-success',
    warning: 'analytics-card-warning',
    danger: 'analytics-card-danger',
  };

  const trendColors = {
    up: 'analytics-trend-up',
    down: 'analytics-trend-down',
    neutral: 'analytics-trend-neutral',
  };

  const trendLabel = trend === 'up' ? 'UP' : trend === 'down' ? 'DOWN' : 'FLAT';
  const trendColorClass =
    trendIntent === 'positive'
      ? trendColors.up
      : trendIntent === 'negative'
        ? trendColors.down
        : trendIntent === 'neutral'
          ? trendColors.neutral
          : trend
            ? trendColors[trend]
            : trendColors.neutral;

  return (
    <article
      className={`analytics-card-enhanced ${variantClasses[variant]} ${className} ${href ? 'cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-primary/50 transition-all' : ''}`}
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

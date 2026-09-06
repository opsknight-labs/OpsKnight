interface ProgressBarProps {
    value: number;
    max?: number;
    label?: string;
    showValue?: boolean;
    variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary';
    size?: 'sm' | 'md' | 'lg';
}

export default function ProgressBar({
    value,
    max = 100,
    label,
    showValue = true,
    variant = 'default',
    size = 'md'
}: ProgressBarProps) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    
    const sizeStyles = {
        sm: { height: '6px' },
        md: { height: '8px' },
        lg: { height: '12px' }
    };

    const variantClasses = {
        default: 'analytics-progress-fill-default',
        success: 'analytics-progress-fill-success',
        warning: 'analytics-progress-fill-warning',
        danger: 'analytics-progress-fill-danger',
        primary: 'analytics-progress-fill-primary'
    };

    return (
        <div className="analytics-progress-container">
            {label && (
                <div className="analytics-progress-label">
                    <span>{label}</span>
                    {showValue && <span className="analytics-progress-value">{percentage.toFixed(0)}%</span>}
                </div>
            )}
            <div className="analytics-progress-bar" style={sizeStyles[size]}>
                <div 
                    className={`analytics-progress-fill ${variantClasses[variant]}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

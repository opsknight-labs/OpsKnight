'use client';

interface RadialProgressProps {
    value: number;
    max?: number;
    size?: number;
    strokeWidth?: number;
    label?: string;
    variant?: 'success' | 'warning' | 'danger' | 'primary';
}

const variantColors = {
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    primary: '#8b5cf6'
};

export default function RadialProgress({
    value,
    max = 100,
    size = 80,
    strokeWidth = 8,
    label,
    variant
}: RadialProgressProps) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    // Auto determine variant based on percentage if not specified
    const autoVariant = percentage >= 80 ? 'success' : percentage >= 50 ? 'warning' : 'danger';
    const color = variantColors[variant || autoVariant];

    return (
        <div className="radial-progress-container" style={{
            position: 'relative',
            width: size,
            height: size,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                {/* Background circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.1)"
                    strokeWidth={strokeWidth}
                />
                {/* Progress circle */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    style={{
                        transition: 'stroke-dashoffset 0.5s ease-out',
                        filter: `drop-shadow(0 0 6px ${color}40)`
                    }}
                />
            </svg>
            <div style={{
                position: 'absolute',
                textAlign: 'center'
            }}>
                <div style={{
                    fontSize: size / 4,
                    fontWeight: 700,
                    color: 'white',
                    lineHeight: 1
                }}>
                    {percentage.toFixed(0)}
                </div>
                {label && (
                    <div style={{
                        fontSize: size / 8,
                        color: 'rgba(255, 255, 255, 0.6)',
                        marginTop: 2
                    }}>
                        {label}
                    </div>
                )}
            </div>
        </div>
    );
}

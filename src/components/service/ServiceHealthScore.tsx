'use client';

import { getHealthScoreColor, getHealthScoreLabel } from '@/lib/service-health';

type ServiceHealthScoreProps = {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'E';
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
    showGrade?: boolean;
};

export default function ServiceHealthScore({ 
    score, 
    grade, 
    size = 'md',
    showLabel = true,
    showGrade = true
}: ServiceHealthScoreProps) {
    const color = getHealthScoreColor(score);
    const label = getHealthScoreLabel(score);

    const sizeStyles = {
        sm: { width: '60px', height: '60px', fontSize: '0.75rem', gradeFontSize: '0.6rem' },
        md: { width: '100px', height: '100px', fontSize: '1.25rem', gradeFontSize: '0.85rem' },
        lg: { width: '140px', height: '140px', fontSize: '1.75rem', gradeFontSize: '1.1rem' }
    };

    const styles = sizeStyles[size];

    // Calculate stroke-dasharray for circular progress
    const circumference = 2 * Math.PI * 40; // radius = 40
    const offset = circumference - (score / 100) * circumference;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ position: 'relative', width: styles.width, height: styles.height }}>
                <svg 
                    width={styles.width} 
                    height={styles.height} 
                    viewBox="0 0 100 100"
                    style={{ transform: 'rotate(-90deg)' }}
                >
                    {/* Background circle */}
                    <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="#e5e7eb"
                        strokeWidth="8"
                    />
                    {/* Progress circle */}
                    <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                    />
                </svg>
                {/* Score text */}
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center'
                }}>
                    <div style={{
                        fontSize: styles.fontSize,
                        fontWeight: '700',
                        color: color,
                        lineHeight: 1
                    }}>
                        {score}
                    </div>
                    {showGrade && (
                        <div style={{
                            fontSize: styles.gradeFontSize,
                            fontWeight: '600',
                            color: 'var(--text-muted)',
                            marginTop: '0.25rem'
                        }}>
                            {grade}
                        </div>
                    )}
                </div>
            </div>
            {showLabel && (
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        color: color
                    }}>
                        {label}
                    </div>
                </div>
            )}
        </div>
    );
}


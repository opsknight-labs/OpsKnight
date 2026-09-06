interface MetricIconProps {
    type: string;
    className?: string;
}

export default function MetricIcon({ type, className = '' }: MetricIconProps) {
    const iconMap: Record<string, string> = {
        'incidents': '📊',
        'mtta': '⚡',
        'mttr': '⏱️',
        'rate': '📈',
        'sla': '🎯',
        'urgency': '🔴',
        'alerts': '🔔',
        'coverage': '🛡️',
        'oncall': '👥',
        'mtbf': '📉',
        'afterhours': '🌙',
        'unassigned': '⚠️'
    };

    const getIcon = (label: string): string => {
        const lower = label.toLowerCase();
        if (lower.includes('incident')) return iconMap.incidents;
        if (lower.includes('mtta')) return iconMap.mtta;
        if (lower.includes('mttr')) return iconMap.mttr;
        if (lower.includes('mtbf')) return iconMap.mtbf;
        if (lower.includes('rate') || lower.includes('ack rate') || lower.includes('resolve rate')) return iconMap.rate;
        if (lower.includes('sla')) return iconMap.sla;
        if (lower.includes('urgency')) return iconMap.urgency;
        if (lower.includes('alert')) return iconMap.alerts;
        if (lower.includes('coverage')) return iconMap.coverage;
        if (lower.includes('on-call') || lower.includes('oncall')) return iconMap.oncall;
        if (lower.includes('after-hours') || lower.includes('afterhours')) return iconMap.afterhours;
        if (lower.includes('unassigned')) return iconMap.unassigned;
        return '📊';
    };

    return (
        <span className={`analytics-metric-icon ${className}`} style={{ fontSize: '1.25rem' }}>
            {getIcon(type)}
        </span>
    );
}


import React from 'react';
import { ArrowUpRight, ArrowDownRight, Sparkles, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

interface InsightCardProps {
    type: string;
    text: string;
}

export default function InsightCard({ type, text }: InsightCardProps) {
    const isPositive = type === 'positive';
    const isNegative = type === 'negative';

    // Icon mapping
    const Icon = isPositive ? TrendingDown : (isNegative ? TrendingUp : Sparkles);
    const colorClass = isPositive ? 'text-green-500' : (isNegative ? 'text-red-500' : 'text-blue-500');
    const bgClass = isPositive ? 'bg-green-500/10' : (isNegative ? 'bg-red-500/10' : 'bg-blue-500/10');
    const borderClass = isPositive ? 'border-l-green-500' : (isNegative ? 'border-l-red-500' : 'border-l-blue-500');

    return (
        <div className={`
            flex items-start gap-3 p-3 w-full
            hover:bg-accent/50 border border-border/40 
            ${borderClass} border-l-4 rounded-r-md
            transition-all duration-200 group
        `}>
            <div className={`p-1.5 rounded-md ${bgClass} ${colorClass} shrink-0 mt-0.5`}>
                <Icon className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-snug">
                    {text}
                </p>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70">
                        Smart Insight
                    </span>
                </div>
            </div>
        </div>
    );
}

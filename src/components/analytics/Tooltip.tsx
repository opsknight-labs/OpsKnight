'use client';

import { useState } from 'react';

interface TooltipProps {
    content: string;
    children: React.ReactNode;
    position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function Tooltip({ content, children, position = 'top' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div 
            className="analytics-tooltip-wrapper"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div className={`analytics-tooltip analytics-tooltip-${position}`}>
                    {content}
                </div>
            )}
        </div>
    );
}

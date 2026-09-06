'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';

type HoverSurfaceProps = {
    baseStyle: CSSProperties;
    hoverStyle?: CSSProperties;
    className?: string;
    children: ReactNode;
};

export default function HoverSurface({ baseStyle, hoverStyle, className, children }: HoverSurfaceProps) {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className={className}
            style={isHovered && hoverStyle ? { ...baseStyle, ...hoverStyle } : baseStyle}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {children}
        </div>
    );
}

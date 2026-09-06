'use client';

import { useState, useRef, useEffect, useLayoutEffect, ReactNode } from 'react';

interface TooltipProps {
    content: string | ReactNode;
    children: ReactNode;
    position?: 'top' | 'bottom' | 'left' | 'right';
    delay?: number;
    disabled?: boolean;
    className?: string;
    maxWidth?: number;
}

/**
 * Enhanced Tooltip component with better positioning and animations
 * 
 * @example
 * <Tooltip content="This is a tooltip" position="top">
 *   <button>Hover me</button>
 * </Tooltip>
 */
export default function Tooltip({
    content,
    children,
    position = 'top',
    delay = 200,
    disabled = false,
    className = '',
    maxWidth = 300,
}: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [calculatedPosition, setCalculatedPosition] = useState(position);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Calculate position to avoid viewport overflow
    useLayoutEffect(() => {
        if (!isVisible || !tooltipRef.current || !wrapperRef.current) return;

        const tooltip = tooltipRef.current;
        const wrapper = wrapperRef.current;
        const rect = wrapper.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let newPosition = position;

        // Check for overflow and adjust position
        if (position === 'top' && rect.top < tooltipRect.height) {
            newPosition = 'bottom';
        } else if (position === 'bottom' && window.innerHeight - rect.bottom < tooltipRect.height) {
            newPosition = 'top';
        } else if (position === 'left' && rect.left < tooltipRect.width) {
            newPosition = 'right';
        } else if (position === 'right' && window.innerWidth - rect.right < tooltipRect.width) {
            newPosition = 'left';
        }

        if (newPosition !== calculatedPosition) {
            setCalculatedPosition(newPosition); // eslint-disable-line react-hooks/set-state-in-effect
        }
    }, [isVisible, position, calculatedPosition]);

    const showTooltip = () => {
        if (disabled) return;

        if (delay > 0) {
            timeoutRef.current = setTimeout(() => {
                setIsVisible(true);
            }, delay);
        } else {
            setIsVisible(true);
        }
    };

    const hideTooltip = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setIsVisible(false);
    };

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const positionStyles = {
        top: {
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
        },
        bottom: {
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '8px',
        },
        left: {
            right: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            marginRight: '8px',
        },
        right: {
            left: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            marginLeft: '8px',
        },
    };

    const arrowStyles = {
        top: {
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            borderTopColor: 'var(--color-neutral-900)',
        },
        bottom: {
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            borderBottomColor: 'var(--color-neutral-900)',
        },
        left: {
            left: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            borderLeftColor: 'var(--color-neutral-900)',
        },
        right: {
            right: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            borderRightColor: 'var(--color-neutral-900)',
        },
    };

    return (
        <div
            ref={wrapperRef}
            className={`ui-tooltip-wrapper ${className}`}
            onMouseEnter={showTooltip}
            onMouseLeave={hideTooltip}
            onFocus={showTooltip}
            onBlur={hideTooltip}
            style={{ position: 'relative', display: 'inline-block' }}
        >
            {children}
            {isVisible && (
                <div
                    ref={tooltipRef}
                    className={`ui-tooltip ui-tooltip-${calculatedPosition}`}
                    role="tooltip"
                    style={{
                        position: 'absolute',
                        zIndex: 10000,
                        ...positionStyles[calculatedPosition],
                        maxWidth: `${maxWidth}px`,
                        padding: 'var(--spacing-2) var(--spacing-3)',
                        background: 'var(--color-neutral-900)',
                        color: 'white',
                        fontSize: 'var(--font-size-sm)',
                        lineHeight: 'var(--line-height-base)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: 'var(--shadow-lg)',
                        pointerEvents: 'none',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        animation: 'fadeIn 0.15s ease-out',
                    }}
                >
                    {content}
                    <div
                        style={{
                            position: 'absolute',
                            width: 0,
                            height: 0,
                            border: '6px solid transparent',
                            ...arrowStyles[calculatedPosition],
                        }}
                    />
                </div>
            )}
        </div>
    );
}








'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { lockBodyScroll } from '@/lib/body-scroll-lock';
import { trapFocus } from '@/lib/focus-trap';

interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  snapPoints?: ('content' | 'half' | 'full')[];
  showHandle?: boolean;
}

/**
 * Native-style bottom sheet modal for mobile UI
 * Supports drag-to-dismiss and snap points
 */
export default function MobileBottomSheet({
  isOpen,
  onClose,
  title,
  children,
  snapPoints = ['content'],
  showHandle = true,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const startY = useRef(0);
  const currentY = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setTranslateY(0);
    return lockBodyScroll();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!sheetRef.current) return;
    return trapFocus(sheetRef.current, onClose);
  }, [isOpen, onClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = translateY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const deltaY = e.touches[0].clientY - startY.current;
    const newTranslateY = Math.max(0, currentY.current + deltaY);
    setTranslateY(newTranslateY);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    const sheetHeight = sheetRef.current?.offsetHeight || 0;

    // If dragged more than 30% down, close the sheet
    if (translateY > sheetHeight * 0.3) {
      onClose();
    } else {
      // Snap back to open position
      setTranslateY(0);
    }
  };

  if (!isOpen) return null;

  const getMaxHeight = () => {
    const snap = snapPoints[0];
    switch (snap) {
      case 'half':
        return '50vh';
      case 'full':
        return '90vh';
      default:
        return 'auto';
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        data-swipe-ignore="true"
        onPointerDown={e => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 z-[150] flex flex-col overflow-hidden rounded-t-3xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-2xl transition-transform duration-300 ease-out animate-in slide-in-from-bottom-6"
        style={{
          maxHeight: getMaxHeight(),
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? 'none' : undefined,
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Bottom sheet'}
        tabIndex={-1}
      >
        {/* Drag Handle */}
        {showHandle && (
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="flex cursor-grab justify-center py-3 touch-none"
          >
            <div className="h-1 w-9 rounded-full bg-[color:var(--border)]" />
          </div>
        )}

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-4">
            <h3 className="text-base font-bold text-[color:var(--text-primary)]" id={titleId}>
              {title}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close bottom sheet"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-secondary)]"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-2">{children}</div>
      </div>
    </>
  );
}

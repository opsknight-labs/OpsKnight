'use client';

import { useEffect, useRef, useState } from 'react';

function scrollParent(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Sizes an element so it fills the remaining visible viewport below its natural position
 * (accounting for the app header, the global incident banner and anything above it), so the
 * whole panel is on screen without scrolling the page. Disabled below `minWidth`, where the
 * layout stacks and natural page scrolling is the better experience.
 */
export function useViewportFill<T extends HTMLElement>({
  minWidth = 1280,
  minHeight = 520,
  bottomGap = 16,
}: { minWidth?: number; minHeight?: number; bottomGap?: number } = {}) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const container = scrollParent(node);
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.innerWidth < minWidth) {
          setHeight(null);
          return;
        }
        // Position as if the page were scrolled to the very top.
        const containerTop = container ? container.getBoundingClientRect().top : 0;
        const scrolled = container ? container.scrollTop : window.scrollY;
        const offsetTop = node.getBoundingClientRect().top - containerTop + scrolled;
        const visible = container ? container.clientHeight : window.innerHeight;
        const next = Math.max(minHeight, Math.floor(visible - offsetTop - bottomGap));
        setHeight(previous => (previous === next ? previous : next));
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    // Anything above the panel changing size (e.g. the incident banner appearing) moves it.
    if (container) observer.observe(container);
    for (let element: HTMLElement | null = node; element && element !== container;) {
      for (let sibling = element.previousElementSibling; sibling;) {
        observer.observe(sibling);
        sibling = sibling.previousElementSibling;
      }
      element = element.parentElement;
    }
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [bottomGap, minHeight, minWidth]);

  return { ref, height };
}

'use client';

/**
 * Skip link for keyboard accessibility.
 * Allows users to skip navigation and jump to main content.
 *
 * Usage: Place at the very top of your layout, before any navigation.
 * The main content area should have id="main-content".
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="
        sr-only focus:not-sr-only focus:absolute focus:z-50
        focus:top-4 focus:left-4
        focus:px-4 focus:py-2
        focus:bg-primary focus:text-primary-foreground
        focus:rounded-md focus:shadow-lg
        focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
        transition-all
      "
    >
      Skip to main content
    </a>
  );
}

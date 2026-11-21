import React from 'react';

/**
 * Each page renders its own header band with the group tabs under it (`IntelligenceGroupHeader`), so
 * the tabs follow DESIGN.md "in-page tabs stay under the header".
 */
export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

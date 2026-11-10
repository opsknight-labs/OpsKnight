import React from 'react';

/**
 * Integration pages are reached from the settings navigation; each one carries its own header, so
 * there is no second row of links to the sibling integrations here.
 */
export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

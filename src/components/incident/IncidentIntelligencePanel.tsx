'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';

/** Server-rendered content stays on the server; Radix provides keyboard navigation and focus handling. */
export default function IncidentIntelligencePanel({
  similar,
  related,
  response,
  summary,
  assistant,
}: {
  similar: ReactNode;
  related: ReactNode;
  response: ReactNode;
  summary: ReactNode;
  assistant: ReactNode;
}) {
  const sections = [
    ['similar', 'Similar', similar],
    ['related', 'Related', related],
    ['response', 'Causes & runbooks', response],
    ['summary', 'Summary', summary],
    ['assistant', 'Ask Squire', assistant],
  ] as const;
  return (
    <section
      aria-labelledby="incident-intelligence-heading"
      className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4"
    >
      <h2 id="incident-intelligence-heading" className="mb-3 text-base font-semibold">
        Intelligence
      </h2>
      <Tabs defaultValue="similar">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList aria-label="Incident intelligence" className="h-auto min-w-max justify-start">
            {sections.map(([value, label]) => (
              <TabsTrigger key={value} value={value} className="min-h-10 px-3 text-xs">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {sections.map(([value, , content]) => (
          <TabsContent key={value} value={value} className="min-h-36">
            {content}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

import type { ReactNode } from 'react';

/** Consistent section frame: heading, one-line purpose and the section body. */
export function SectionPanel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4">
      <div className="space-y-0.5">
        <h3 id={headingId} className="text-base font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

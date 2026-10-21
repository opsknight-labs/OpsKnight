import type { ReactNode } from 'react';

/** Consistent section frame: accessible heading, compact one-line purpose and the section body. */
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
    <section aria-labelledby={headingId} className="min-w-0 space-y-3.5">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 id={headingId} className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 space-y-3.5">{children}</div>
    </section>
  );
}

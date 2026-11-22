import Link from 'next/link';
import { Boxes } from 'lucide-react';

/** "Impacts: Checkout, Payments" — business services that contain the incident's service. */
export default function IncidentImpacts({
  businessServices,
  linkable = true,
}: {
  businessServices: Array<{ id: string; name: string }>;
  linkable?: boolean;
}) {
  if (!businessServices.length) return null;
  const chip =
    'inline-flex h-6 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 text-xs font-medium text-foreground';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" aria-hidden />
        Impacts
      </span>
      <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Affected business services">
        {businessServices.map(service => (
          <li key={service.id}>
            {linkable ? (
              <Link
                href={`/services/business/${service.id}`}
                className={`${chip} transition-colors hover:border-foreground/30 hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring`}
              >
                {service.name}
              </Link>
            ) : (
              <span className={chip}>{service.name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

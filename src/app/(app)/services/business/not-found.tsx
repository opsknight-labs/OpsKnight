import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';

export default function BusinessServicesNotFound() {
  return (
    <div className="p-6">
      <EmptyState
        variant="simple"
        icon={<Boxes className="h-6 w-6" aria-hidden />}
        title="Page not found"
        description="This business services page does not exist."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/services/business">Back to business services</Link>
          </Button>
        }
      />
    </div>
  );
}

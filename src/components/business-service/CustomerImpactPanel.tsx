import { RelativeTime } from '@/components/patterns';
import { formatMoney } from '@/lib/business-services/impact-cost';
import AddCustomerReportForm from './AddCustomerReportForm';

export type CustomerImpactView = {
  businessServiceId: string;
  /** Estimated downtime cost over the window; null when no revenue rate is set. */
  estimatedCostCents: number | null;
  currency: string;
  customersTotal: number | null;
  windowDays: number;
  threshold: number | null;
  thresholdWindowMinutes: number | null;
  reports: ReadonlyArray<{
    id: string;
    source: string;
    count: number;
    windowEnd: Date;
  }>;
  canAdd: boolean;
};

/** Cost of downtime, customers exposed and customer-reported impact for one business service. */
export default function CustomerImpactPanel({ view }: { view: CustomerImpactView }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">
            Estimated downtime cost, last {view.windowDays} days
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {view.estimatedCostCents === null
              ? 'Not set'
              : formatMoney(view.estimatedCostCents, view.currency)}
          </dd>
          {view.estimatedCostCents === null && (
            <dd className="text-xs text-muted-foreground">
              Add revenue per hour in the business service settings.
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Customers exposed</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {view.customersTotal === null ? 'Unknown' : view.customersTotal.toLocaleString('en-US')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Customer reports lift health</dt>
          <dd className="text-sm">
            {view.threshold === null
              ? 'Off'
              : `At ${view.threshold} in ${view.thresholdWindowMinutes ?? 60} minutes`}
          </dd>
        </div>
      </dl>
      {view.reports.length > 0 && (
        <ul className="divide-y rounded-md border text-sm" aria-label="Recent customer reports">
          {view.reports.map(report => (
            <li key={report.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-medium tabular-nums">{report.count}</span> from{' '}
                <span className="capitalize">{report.source}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                <RelativeTime date={report.windowEnd} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.canAdd && <AddCustomerReportForm businessServiceId={view.businessServiceId} />}
    </div>
  );
}

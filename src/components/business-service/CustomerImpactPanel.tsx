import { RelativeTime } from '@/components/patterns';
import { formatMoney } from '@/lib/business-services/impact-cost';
import AddCustomerReportForm, { DeleteCustomerReportButton } from './AddCustomerReportForm';

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
    createdById?: string | null;
  }>;
  canAdd: boolean;
  /** The viewer; they may delete reports they recorded themselves (when they can add). */
  viewerId?: string;
};

const term = 'text-xs font-medium text-muted-foreground';
const value = 'text-lg font-semibold tabular-nums';

/** Cost of downtime, total customers and customer-reported impact for one business service. */
export default function CustomerImpactPanel({ view }: { view: CustomerImpactView }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className={term}>Estimated downtime cost, last {view.windowDays} days</dt>
          <dd className={value}>
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
          <dt className={term}>Total customers</dt>
          <dd className={value}>
            {view.customersTotal === null ? 'Unknown' : view.customersTotal.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className={term}>Customer reports lift health</dt>
          <dd className={value}>
            {view.threshold === null
              ? 'Off'
              : `At ${view.threshold} in ${view.thresholdWindowMinutes ?? 60} min`}
          </dd>
        </div>
      </dl>
      {view.reports.length > 0 && (
        <ul className="divide-y rounded-md border text-sm" aria-label="Recent customer reports">
          {view.reports.map(report => {
            const label = `${report.count.toLocaleString()} ${report.source} report${report.count === 1 ? '' : 's'}`;
            return (
              <li key={report.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium tabular-nums">{report.count.toLocaleString()}</span>{' '}
                  from <span className="capitalize">{report.source}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  <RelativeTime date={report.windowEnd} />
                </span>
                {view.canAdd && view.viewerId && report.createdById === view.viewerId && (
                  <DeleteCustomerReportButton
                    businessServiceId={view.businessServiceId}
                    reportId={report.id}
                    label={label}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {view.canAdd && <AddCustomerReportForm businessServiceId={view.businessServiceId} />}
    </div>
  );
}

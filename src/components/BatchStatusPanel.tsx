import type { BatchQueueTotals } from "../services/batchQueue";

interface BatchStatusPanelProps {
  queueStatusLabel: string;
  activeRowUrl: string | null;
  activeJobId: string | null;
  totals: BatchQueueTotals;
  completionSummary: string | null;
}

export function BatchStatusPanel({
  queueStatusLabel,
  activeRowUrl,
  activeJobId,
  totals,
  completionSummary,
}: BatchStatusPanelProps): JSX.Element {
  return (
    <section className="batch-status-panel" aria-label="Batch queue status">
      <div className="batch-status-headline">
        <span className="label">Queue status</span>
        <strong>{queueStatusLabel}</strong>
      </div>
      <div className="batch-active-row">
        <span className="label">Active URL</span>
        <strong>{activeRowUrl ?? "No active row"}</strong>
      </div>
      <div className="batch-active-job">
        <span className="label">Active job</span>
        <strong>{activeJobId ?? "-"}</strong>
      </div>
        <div className="batch-totals" aria-label="Batch queue totals">
        <div>
          <span className="label">Total</span>
          <strong>{totals.total}</strong>
        </div>
        <div>
          <span className="label">Running</span>
          <strong>{totals.running}</strong>
        </div>
        <div>
          <span className="label">Success</span>
          <strong>{totals.success}</strong>
        </div>
        <div>
          <span className="label">Failed</span>
          <strong>{totals.failed}</strong>
        </div>
        <div>
          <span className="label">Skipped</span>
          <strong>{totals.skipped}</strong>
        </div>
        </div>
        {completionSummary ? <p className="batch-completion-summary">{completionSummary}</p> : null}
      </section>
  );
}

interface JobStatusPlaceholderProps {
  activeJobId: string | null;
}

export function JobStatusPlaceholder({ activeJobId }: JobStatusPlaceholderProps): JSX.Element {
  const statusLabel = activeJobId ? "Queued" : "Idle";

  return (
    <section className="card">
      <h2>Active job status</h2>
      <div className="counts-grid">
        <div>
          <span className="label">Status</span>
          <strong>{statusLabel}</strong>
        </div>
        <div>
          <span className="label">Total</span>
          <strong>0</strong>
        </div>
        <div>
          <span className="label">Success</span>
          <strong>0</strong>
        </div>
        <div>
          <span className="label">Failed</span>
          <strong>0</strong>
        </div>
        <div>
          <span className="label">Skipped</span>
          <strong>0</strong>
        </div>
      </div>
      {activeJobId ? (
        <p className="hint">Active job id: {activeJobId}</p>
      ) : null}
      <p className="hint">Polling state and friendly errors are implemented in later Phase 1 beads.</p>
    </section>
  );
}

import type { JobState } from "../services/backendClient";

interface JobStatusPanelProps {
  activeJobId: string | null;
  jobState: JobState | null;
  message: string;
  messageTone: "error" | "hint";
  showResultActions: boolean;
  openOutputDisabled: boolean;
  openOutputDisabledReason: string;
  openOutputInProgress: boolean;
  showCookieRecoveryActions: boolean;
  cookieRecoveryInProgress: boolean;
  retryGuidance: string;
  fallbackGuidance: string;
  onRecoverCookies: () => void;
  onOpenOutputFolder: () => void;
}

export function JobStatusPanel({
  activeJobId,
  jobState,
  message,
  messageTone,
  showResultActions,
  openOutputDisabled,
  openOutputDisabledReason,
  openOutputInProgress,
  showCookieRecoveryActions,
  cookieRecoveryInProgress,
  retryGuidance,
  fallbackGuidance,
  onRecoverCookies,
  onOpenOutputFolder,
}: JobStatusPanelProps): JSX.Element {
  const statusLabel = getStatusLabel(activeJobId, jobState);
  const counts = jobState?.counts ?? {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

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
          <strong>{counts.total}</strong>
        </div>
        <div>
          <span className="label">Success</span>
          <strong>{counts.success}</strong>
        </div>
        <div>
          <span className="label">Failed</span>
          <strong>{counts.failed}</strong>
        </div>
        <div>
          <span className="label">Skipped</span>
          <strong>{counts.skipped}</strong>
        </div>
      </div>
        {activeJobId ? <p className="hint">Active job id: {activeJobId}</p> : null}
        {message ? (
          <p className={messageTone === "error" ? "status-message status-message-error" : "hint"}>{message}</p>
        ) : null}
        {showResultActions ? (
          <section className="result-actions" aria-label="Result actions">
            <button type="button" onClick={onOpenOutputFolder} disabled={openOutputDisabled}>
              {openOutputInProgress ? "Opening..." : "Open output folder"}
            </button>
              {openOutputDisabledReason ? <p className="hint">{openOutputDisabledReason}</p> : null}
            </section>
          ) : null}
          {showCookieRecoveryActions ? (
            <section className="result-actions" aria-label="Cookie recovery actions">
              <button type="button" className="secondary" onClick={onRecoverCookies} disabled={cookieRecoveryInProgress}>
                {cookieRecoveryInProgress ? "Fetching..." : "Fetch cookies again"}
              </button>
              <p className="hint">{retryGuidance}</p>
              <p className="hint">{fallbackGuidance}</p>
            </section>
          ) : null}
        </section>
      );
}

function getStatusLabel(activeJobId: string | null, jobState: JobState | null): string {
  if (!activeJobId) {
    return "Idle";
  }

  if (!jobState) {
    return "Pending";
  }

  return `${jobState.status.slice(0, 1).toUpperCase()}${jobState.status.slice(1)}`;
}

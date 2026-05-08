import { isBatchRowRetryEligible, type BatchQueueRow } from "../services/batchQueue";
import { mapFailedJobError } from "../services/errorMapper";

const RETRY_FAILED_MESSAGE = "Use Retry failed to try this row again.";
const COOKIE_RECOVERY_MESSAGE =
  "Douyin login cookies may be missing or expired. Use Fetch Cookies again, then Retry failed.";

interface QueueTableProps {
  rows: BatchQueueRow[];
  onRetryRow: (rowId: string) => void;
}

export function QueueTable({ rows, onRetryRow }: QueueTableProps): JSX.Element {
  if (rows.length === 0) {
    return <p className="hint">No queue rows yet.</p>;
  }

  return (
    <section className="queue-table-shell" aria-label="Batch queue table">
        <table className="queue-table">
          <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Source</th>
                <th scope="col">Job</th>
                <th scope="col">Status</th>
                <th scope="col">Reason</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const statusLabel = getStatusLabel(row.status);
                const reasonLabel = getReasonLabel(row);
                const canRetryRow = isBatchRowRetryEligible(row);
                return (
                  <tr key={row.id} data-status={row.status}>
                    <td>{index + 1}</td>
                    <td>{row.sourceText || "(blank line)"}</td>
                    <td>{row.currentJobId ?? row.lastJobId ?? "-"}</td>
                    <td>{statusLabel}</td>
                    <td>{reasonLabel}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onRetryRow(row.id)}
                        disabled={!canRetryRow}
                        aria-label={`Retry row ${index + 1}`}
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </section>
  );
}

function getStatusLabel(status: BatchQueueRow["status"]): string {
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

function getReasonLabel(row: BatchQueueRow): string {
  if (row.status === "failed") {
    return getFailedReasonLabel(row.lastError);
  }
  if (row.lastError) {
    return row.lastError;
  }
  if (!row.skipReason) {
    return row.status === "waiting" ? "ready" : "-";
  }
  return getSkipReasonLabel(row.skipReason);
}

function getFailedReasonLabel(lastError: BatchQueueRow["lastError"]): string {
  if (!lastError) {
    return `Download failed. ${RETRY_FAILED_MESSAGE}`;
  }

  if (isCookieFailure(lastError)) {
    return COOKIE_RECOVERY_MESSAGE;
  }

  const mapped = mapFailedJobError(lastError);
  if (!mapped) {
    return `Download failed. ${RETRY_FAILED_MESSAGE}`;
  }

  return `${mapped.message} ${RETRY_FAILED_MESSAGE}`;
}

function isCookieFailure(lastError: string): boolean {
  const lowered = lastError.toLowerCase();
  return (
    lowered.includes("cookie") ||
    lowered.includes("mstoken") ||
    lowered.includes("ttwid") ||
    lowered.includes("login") ||
    lowered.includes("401") ||
    lowered.includes("403")
  );
}

function getSkipReasonLabel(skipReason: BatchQueueRow["skipReason"]): string {
  switch (skipReason) {
    case "blank":
      return "blank line";
    case "invalid_url":
      return "invalid URL";
    case "unsupported_host":
      return "unsupported host";
    case "duplicate":
      return "duplicate";
    default:
      return "ready";
  }
}

import type { BatchQueueRow } from "../services/batchQueue";

interface QueueTableProps {
  rows: BatchQueueRow[];
}

export function QueueTable({ rows }: QueueTableProps): JSX.Element {
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const statusLabel = getStatusLabel(row.status);
              const reasonLabel = getReasonLabel(row);
              return (
                <tr key={row.id} data-status={row.status}>
                  <td>{index + 1}</td>
                  <td>{row.sourceText || "(blank line)"}</td>
                  <td>{row.currentJobId ?? row.lastJobId ?? "-"}</td>
                  <td>{statusLabel}</td>
                  <td>{reasonLabel}</td>
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
    return "Download failed. Use Retry failed to try this row again.";
  }
  if (row.lastError) {
    return row.lastError;
  }
  if (!row.skipReason) {
    return row.status === "waiting" ? "ready" : "-";
  }
  return getSkipReasonLabel(row.skipReason);
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

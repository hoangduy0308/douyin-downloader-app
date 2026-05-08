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
            <th scope="col">Status</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const statusLabel = row.status === "skipped" ? "Skipped" : "Waiting";
            const reasonLabel = row.skipReason ? getSkipReasonLabel(row.skipReason) : "ready";
            return (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.sourceText || "(blank line)"}</td>
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

import type { HistoryEntry } from "../services/historyStore";

interface HistoryPanelProps {
  entries: HistoryEntry[];
}

export function HistoryPanel({ entries }: HistoryPanelProps): JSX.Element {
  return (
    <section className="card history-card" aria-label="History panel">
      <h2>Recent history</h2>
      <p className="hint">Basic terminal outcomes only. Advanced history controls are out of scope.</p>
      {entries.length === 0 ? (
        <p className="hint">No finished downloads yet.</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li key={entry.logicalId} className="history-item">
              <p className="history-url">{entry.url}</p>
              <p className="history-meta">
                <span>{entry.mode}</span>
                <span>{entry.status}</span>
                <span>{entry.finishedAt}</span>
              </p>
              <p className="history-meta">
                <span>{entry.outputPath ?? "No output path"}</span>
                {entry.errorSummary ? <span>{entry.errorSummary}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

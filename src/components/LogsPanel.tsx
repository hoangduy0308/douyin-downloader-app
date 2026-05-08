import type { AppLogEvent } from "../services/logStore";

interface LogsPanelProps {
  events: AppLogEvent[];
  cap: number;
}

export function LogsPanel({ events, cap }: LogsPanelProps): JSX.Element {
  return (
    <section className="logs-panel" aria-label="Logs panel">
      <h2>Logs</h2>
      <p className="hint">Raw diagnostics are isolated here for power users. Single and Batch surfaces stay friendly.</p>
      <p className="logs-count">Entries: {events.length} / {cap}</p>
      {events.length === 0 ? (
        <p className="hint">No diagnostics captured yet.</p>
      ) : (
        <ol className="logs-list">
          {events.map((event, index) => (
            <li key={`${event.at}-${event.source}-${index}`}>
              <p className="logs-meta">
                <strong>{event.level.toUpperCase()}</strong> [{event.source}] {event.at}
              </p>
              <p className="logs-message">{event.message}</p>
              {event.context ? (
                <p className="logs-context">{JSON.stringify(event.context)}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

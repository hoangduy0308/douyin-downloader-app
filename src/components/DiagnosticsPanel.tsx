import { useState } from "react";

interface DiagnosticsPanelProps {
  backendDiagnostics: string[];
  jobDiagnostics: string[];
}

interface DiagnosticEntry {
  source: "backend" | "job";
  message: string;
}

export function DiagnosticsPanel({ backendDiagnostics, jobDiagnostics }: DiagnosticsPanelProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const entries: DiagnosticEntry[] = [
    ...backendDiagnostics.map((message) => ({ source: "backend" as const, message })),
    ...jobDiagnostics.map((message) => ({ source: "job" as const, message })),
  ];

  return (
    <section className="card diagnostics-card" aria-label="Diagnostics panel">
      <h2>Diagnostics</h2>
      <p className="hint">Technical details stay here so the main status panel can remain user-focused.</p>
      <div className="diagnostics-toolbar">
        <button
          type="button"
          className="secondary"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide diagnostics" : "Show diagnostics"}
        </button>
        <span className="diagnostics-count">Entries: {entries.length}</span>
      </div>
      {expanded ? (
        entries.length > 0 ? (
          <ul className="diagnostics-list">
            {entries.map((entry, index) => (
              <li key={`${entry.source}-${index}`}>
                <strong>{entry.source === "backend" ? "Backend" : "Job"}:</strong> {entry.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">No diagnostics captured yet.</p>
        )
      ) : (
        <p className="hint">Diagnostics are hidden by default.</p>
      )}
    </section>
  );
}

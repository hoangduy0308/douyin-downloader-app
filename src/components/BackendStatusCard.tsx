type BackendStatus = "starting" | "ready" | "error" | "stopped";

interface BackendStatusCardProps {
  status: BackendStatus;
  detail: string;
}

export function BackendStatusCard({ status, detail }: BackendStatusCardProps): JSX.Element {
  const label =
    status === "starting"
      ? "Starting backend..."
      : status === "ready"
        ? "Ready"
        : status === "stopped"
          ? "Stopped"
          : "Action needed";

  return (
    <section className="card">
      <h2>Backend readiness</h2>
      <p className="status-row">
        <span className={`status-dot ${status}`} aria-hidden="true" />
        <strong>{label}</strong>
      </p>
      <p className="hint">{detail}</p>
    </section>
  );
}

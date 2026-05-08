import type { BatchQueueRow, BatchQueueTotals } from "../services/batchQueue";
import { BatchStatusPanel } from "./BatchStatusPanel";
import { QueueTable } from "./QueueTable";

interface BatchDownloadPanelProps {
  inputText: string;
  onInputTextChange: (value: string) => void;
  onBuildQueue: () => void;
  onStartQueue: () => void;
  onImportText: () => void;
  queueStatusLabel: string;
  activeRowUrl: string | null;
  activeJobId: string | null;
  totals: BatchQueueTotals;
  rows: BatchQueueRow[];
  message: string;
  messageTone: "error" | "hint";
  startDisabled: boolean;
}

export function BatchDownloadPanel({
  inputText,
  onInputTextChange,
  onBuildQueue,
  onStartQueue,
  onImportText,
  queueStatusLabel,
  activeRowUrl,
  activeJobId,
  totals,
  rows,
  message,
  messageTone,
  startDisabled,
}: BatchDownloadPanelProps): JSX.Element {
  return (
    <section className="batch-panel" aria-label="Batch download panel">
      <label htmlFor="batch-input">Batch URLs</label>
      <textarea
        id="batch-input"
        name="batch-input"
        value={inputText}
        onChange={(event) => onInputTextChange(event.target.value)}
        placeholder={"https://www.douyin.com/video/...\nhttps://www.iesdouyin.com/share/video/..."}
        rows={5}
      />
        <div className="batch-toolbar">
          <button type="button" onClick={onBuildQueue}>
            Build queue
          </button>
          <button type="button" onClick={onStartQueue} disabled={startDisabled}>
            Start batch
          </button>
          <button type="button" className="secondary" onClick={onImportText}>
            Import URLs
          </button>
        </div>
        <BatchStatusPanel
          queueStatusLabel={queueStatusLabel}
          activeRowUrl={activeRowUrl}
          activeJobId={activeJobId}
          totals={totals}
        />
        <p className={messageTone === "error" ? "status-message status-message-error" : "hint"}>{message}</p>
        <QueueTable rows={rows} />
      </section>
  );
}

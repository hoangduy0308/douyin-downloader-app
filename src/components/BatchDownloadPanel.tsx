import type { BatchQueueRow, BatchQueueTotals } from "../services/batchQueue";
import { QueueTable } from "./QueueTable";

interface BatchDownloadPanelProps {
  inputText: string;
  onInputTextChange: (value: string) => void;
  onBuildQueue: () => void;
  onImportText: () => void;
  totals: BatchQueueTotals;
  rows: BatchQueueRow[];
  message: string;
  messageTone: "error" | "hint";
}

export function BatchDownloadPanel({
  inputText,
  onInputTextChange,
  onBuildQueue,
  onImportText,
  totals,
  rows,
  message,
  messageTone,
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
        <button type="button" className="secondary" onClick={onImportText}>
          Import URLs
        </button>
      </div>
      <div className="batch-totals" aria-label="Batch queue totals">
        <div>
          <span className="label">Total</span>
          <strong>{totals.total}</strong>
        </div>
        <div>
          <span className="label">Ready</span>
          <strong>{totals.readyToSubmit}</strong>
        </div>
        <div>
          <span className="label">Skipped</span>
          <strong>{totals.skipped}</strong>
        </div>
      </div>
      <p className={messageTone === "error" ? "status-message status-message-error" : "hint"}>{message}</p>
      <QueueTable rows={rows} />
    </section>
  );
}

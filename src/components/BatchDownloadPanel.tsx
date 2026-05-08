import type { BatchQueueRow, BatchQueueTotals } from "../services/batchQueue";
import { BatchStatusPanel } from "./BatchStatusPanel";
import { QueueTable } from "./QueueTable";

interface BatchDownloadPanelProps {
  inputText: string;
  onInputTextChange: (value: string) => void;
  onBuildQueue: () => void;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onResumeQueue: () => void;
  onRetryQueue: () => void;
  onImportText: () => void;
  queueStatusLabel: string;
  activeRowUrl: string | null;
  activeJobId: string | null;
  totals: BatchQueueTotals;
  completionSummary: string | null;
  rows: BatchQueueRow[];
  message: string;
  messageTone: "error" | "hint";
  startDisabled: boolean;
  pauseDisabled: boolean;
  resumeDisabled: boolean;
  retryDisabled: boolean;
  showResultActions: boolean;
  openOutputDisabled: boolean;
  openOutputDisabledReason: string;
  openOutputInProgress: boolean;
  onOpenOutputFolder: () => void;
}

export function BatchDownloadPanel({
  inputText,
  onInputTextChange,
  onBuildQueue,
  onStartQueue,
  onPauseQueue,
  onResumeQueue,
  onRetryQueue,
  onImportText,
  queueStatusLabel,
  activeRowUrl,
  activeJobId,
  totals,
  completionSummary,
  rows,
  message,
  messageTone,
  startDisabled,
  pauseDisabled,
  resumeDisabled,
  retryDisabled,
  showResultActions,
  openOutputDisabled,
  openOutputDisabledReason,
  openOutputInProgress,
  onOpenOutputFolder,
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
          <button type="button" className="secondary" onClick={onPauseQueue} disabled={pauseDisabled}>
            Pause queue
          </button>
          <button type="button" className="secondary" onClick={onResumeQueue} disabled={resumeDisabled}>
            Resume queue
          </button>
          <button type="button" className="secondary" onClick={onRetryQueue} disabled={retryDisabled}>
            Retry failed
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
            completionSummary={completionSummary}
          />
          <p className={messageTone === "error" ? "status-message status-message-error" : "hint"}>{message}</p>
          {showResultActions ? (
            <section className="result-actions" aria-label="Batch result actions">
              <button type="button" onClick={onOpenOutputFolder} disabled={openOutputDisabled}>
                {openOutputInProgress ? "Opening..." : "Open output folder"}
              </button>
              {openOutputDisabledReason ? <p className="hint">{openOutputDisabledReason}</p> : null}
            </section>
          ) : null}
          <QueueTable rows={rows} />
        </section>
    );
}

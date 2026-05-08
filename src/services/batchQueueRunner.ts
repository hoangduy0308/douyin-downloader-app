import type { BackendClient, JobState } from "./backendClient";
import type { BatchQueueRow, BatchQueueTotals } from "./batchQueue";
import { summarizeBatchQueue } from "./batchQueue";

export const DEFAULT_BATCH_QUEUE_CONCURRENCY_LIMIT = 2;
export const DEFAULT_BATCH_QUEUE_POLL_INTERVAL_MS = 1000;

export interface BatchQueueRunnerSnapshot {
  rows: BatchQueueRow[];
  totals: BatchQueueTotals;
  schedulingEnabled: boolean;
  inFlightSubmissions: number;
  activePolls: number;
}

export interface BatchQueueRunnerOptions {
  backendClient: Pick<BackendClient, "createDownloadJob" | "getJob">;
  concurrencyLimit?: number;
  pollIntervalMs?: number;
  setTimer?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  onSnapshot?: (snapshot: BatchQueueRunnerSnapshot) => void;
}

export interface BatchQueueRunner {
  start: (rows: BatchQueueRow[]) => void;
  stop: () => void;
  setSchedulingEnabled: (enabled: boolean) => void;
  getSnapshot: () => BatchQueueRunnerSnapshot;
}

export function createBatchQueueRunner(options: BatchQueueRunnerOptions): BatchQueueRunner {
  const concurrencyLimit = Math.max(1, options.concurrencyLimit ?? DEFAULT_BATCH_QUEUE_CONCURRENCY_LIMIT);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_BATCH_QUEUE_POLL_INTERVAL_MS;
  const setTimer = options.setTimer ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));

  let rows: BatchQueueRow[] = [];
  let active = false;
  let schedulingEnabled = true;
  const submittingRowIds = new Set<string>();
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const getRowById = (rowId: string): BatchQueueRow | undefined => {
    return rows.find((row) => row.id === rowId);
  };

  const cloneRows = (): BatchQueueRow[] => {
    return rows.map((row) => ({ ...row }));
  };

  const toMessage = (error: unknown): string => {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return "Unknown queue runner error";
  };

  const getSnapshot = (): BatchQueueRunnerSnapshot => {
    const rowsSnapshot = cloneRows();
    return {
      rows: rowsSnapshot,
      totals: summarizeBatchQueue(rowsSnapshot),
      schedulingEnabled,
      inFlightSubmissions: submittingRowIds.size,
      activePolls: pollTimers.size,
    };
  };

  const emitSnapshot = (): void => {
    options.onSnapshot?.(getSnapshot());
  };

  const clearPollTimer = (rowId: string): void => {
    const timer = pollTimers.get(rowId);
    if (timer === undefined) {
      return;
    }
    clearTimer(timer);
    pollTimers.delete(rowId);
  };

  const clearAllPollTimers = (): void => {
    for (const timer of pollTimers.values()) {
      clearTimer(timer);
    }
    pollTimers.clear();
  };

  const updateRowFailure = (row: BatchQueueRow, error: unknown): void => {
    row.status = "failed";
    row.currentJobId = null;
    row.lastError = toMessage(error);
    row.retryEligible = true;
  };

  const hasCapacity = (): boolean => {
    return submittingRowIds.size + pollTimers.size < concurrencyLimit;
  };

  const isSubmittableRow = (row: BatchQueueRow): boolean => {
    return (
      row.status === "waiting" &&
      row.normalizedUrl !== null &&
      row.currentJobId === null &&
      !submittingRowIds.has(row.id)
    );
  };

  const schedulePoll = (rowId: string, pollOnce: () => void): void => {
    clearPollTimer(rowId);
    const timer = setTimer(pollOnce, pollIntervalMs);
    pollTimers.set(rowId, timer);
  };

  const runScheduler = async (): Promise<void> => {
    if (!active || !schedulingEnabled) {
      return;
    }

    while (hasCapacity()) {
      const nextRow = rows.find(isSubmittableRow);
      if (nextRow === undefined) {
        break;
      }
      void submitRow(nextRow.id);
    }
  };

  const submitRow = async (rowId: string): Promise<void> => {
    if (!active) {
      return;
    }

    const row = getRowById(rowId);
    if (row === undefined || !isSubmittableRow(row)) {
      return;
    }

    submittingRowIds.add(row.id);
    row.status = "running";
    row.retryEligible = false;
    row.lastError = null;
    row.attempt += 1;
    emitSnapshot();

    try {
      const response = await options.backendClient.createDownloadJob({ url: row.normalizedUrl! });
      if (!active) {
        return;
      }

      const currentRow = getRowById(rowId);
      if (currentRow === undefined) {
        return;
      }

      currentRow.currentJobId = response.jobId;
      currentRow.lastJobId = response.jobId;
      currentRow.status = "running";
      currentRow.lastError = null;
      emitSnapshot();

      const pollOnce = async (): Promise<void> => {
        if (!active) {
          return;
        }

        const rowForPoll = getRowById(rowId);
        if (rowForPoll === undefined || rowForPoll.currentJobId !== response.jobId) {
          clearPollTimer(rowId);
          return;
        }

        try {
          const job = await options.backendClient.getJob(response.jobId);
          if (!active) {
            return;
          }

          const latestRow = getRowById(rowId);
          if (latestRow === undefined || latestRow.currentJobId !== response.jobId) {
            clearPollTimer(rowId);
            return;
          }

          if (job.status === "pending" || job.status === "running") {
            latestRow.status = "running";
            latestRow.lastError = null;
            emitSnapshot();
            schedulePoll(rowId, () => {
              void pollOnce();
            });
            return;
          }

          clearPollTimer(rowId);
          applyTerminalState(latestRow, job);
          emitSnapshot();
          void runScheduler();
        } catch (error) {
          const latestRow = getRowById(rowId);
          clearPollTimer(rowId);
          if (latestRow !== undefined) {
            updateRowFailure(latestRow, error);
          }
          emitSnapshot();
          void runScheduler();
        }
      };

      schedulePoll(rowId, () => {
        void pollOnce();
      });
    } catch (error) {
      updateRowFailure(row, error);
      emitSnapshot();
    } finally {
      submittingRowIds.delete(row.id);
      emitSnapshot();
      void runScheduler();
    }
  };

  const start = (initialRows: BatchQueueRow[]): void => {
    clearAllPollTimers();
    submittingRowIds.clear();
    rows = initialRows.map((row) => ({ ...row }));
    active = true;
    schedulingEnabled = true;
    emitSnapshot();
    void runScheduler();
  };

  const stop = (): void => {
    active = false;
    submittingRowIds.clear();
    clearAllPollTimers();
    emitSnapshot();
  };

  const setSchedulingEnabled = (enabled: boolean): void => {
    schedulingEnabled = enabled;
    emitSnapshot();
    if (enabled) {
      void runScheduler();
    }
  };

  return {
    start,
    stop,
    setSchedulingEnabled,
    getSnapshot,
  };
}

function applyTerminalState(row: BatchQueueRow, job: JobState): void {
  row.currentJobId = null;
  if (job.status === "success") {
    row.status = "success";
    row.retryEligible = false;
    row.lastError = null;
    return;
  }

  row.status = "failed";
  row.retryEligible = true;
  row.lastError = job.error ?? `Job ended with status ${job.status}`;
}

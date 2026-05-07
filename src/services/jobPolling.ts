import type { BackendClient, JobState } from "./backendClient";

export interface JobPollerOptions {
  jobId: string;
  backendClient: Pick<BackendClient, "getJob">;
  onJob: (job: JobState) => void;
  onError: (error: unknown) => void;
  pollIntervalMs?: number;
  setTimer?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface JobPoller {
  start: () => void;
  stop: () => void;
}

export function createJobPoller(options: JobPollerOptions): JobPoller {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const setTimer = options.setTimer ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    active = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const scheduleNext = (): void => {
    if (!active) {
      return;
    }
    timer = setTimer(() => {
      void pollOnce();
    }, pollIntervalMs);
  };

  const pollOnce = async (): Promise<void> => {
    if (!active) {
      return;
    }

    try {
      const job = await options.backendClient.getJob(options.jobId);
      if (!active) {
        return;
      }
      options.onJob(job);
      if (isTerminalStatus(job.status)) {
        stop();
        return;
      }
      scheduleNext();
    } catch (error) {
      if (!active) {
        return;
      }
      options.onError(error);
      stop();
    }
  };

  const start = (): void => {
    if (active) {
      return;
    }
    active = true;
    void pollOnce();
  };

  return {
    start,
    stop,
  };
}

function isTerminalStatus(status: JobState["status"]): boolean {
  return status === "success" || status === "failed" || status === "cancelled";
}

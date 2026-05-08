import { vi } from "vitest";
import type { BackendClient, JobState } from "../services/backendClient";
import { parseBatchQueueInput } from "../services/batchQueue";
import { createBatchQueueRunner } from "../services/batchQueueRunner";

function buildJob(job: Partial<JobState>): JobState {
  return {
    jobId: "job-1",
    status: "pending",
    submittedAt: "2026-05-08T00:00:00Z",
    startedAt: null,
    finishedAt: null,
    counts: {
      total: 1,
      success: 0,
      failed: 0,
      skipped: 0,
    },
    error: null,
    ...job,
  };
}

function createDeferred<TValue>(): {
  promise: Promise<TValue>;
  resolve: (value: TValue) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: TValue) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe("batchQueueRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits only the default concurrency of waiting rows and stores job ids", async () => {
    const parseResult = parseBatchQueueInput(
      [
        "https://www.douyin.com/video/100",
        "https://www.douyin.com/video/200",
        "https://www.douyin.com/video/300",
        "not-a-url",
      ].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-1", status: "pending" })
      .mockResolvedValueOnce({ jobId: "job-2", status: "pending" });
    const getJob = vi.fn<BackendClient["getJob"]>().mockResolvedValue(buildJob({ status: "pending" }));
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
    });

    runner.start(parseResult.rows);
    await vi.runAllTicks();

    const snapshot = runner.getSnapshot();
    const firstRow = snapshot.rows[0];
    const secondRow = snapshot.rows[1];
    const thirdRow = snapshot.rows[2];
    const invalidRow = snapshot.rows[3];

    expect(createDownloadJob).toHaveBeenCalledTimes(2);
    expect(createDownloadJob).toHaveBeenNthCalledWith(1, { url: firstRow.normalizedUrl });
    expect(createDownloadJob).toHaveBeenNthCalledWith(2, { url: secondRow.normalizedUrl });
    expect(firstRow.currentJobId).toBe("job-1");
    expect(secondRow.currentJobId).toBe("job-2");
    expect(thirdRow.status).toBe("waiting");
    expect(invalidRow.status).toBe("skipped");
    expect(snapshot.totals.running).toBe(2);
    expect(snapshot.totals.waiting).toBe(1);
    expect(snapshot.totals.skipped).toBe(1);
  });

  it("never submits ftp/file scheme rows from parsed batch input", async () => {
    const parseResult = parseBatchQueueInput(
      [
        "ftp://www.douyin.com/video/100",
        "file://www.douyin.com/video/200",
        "https://www.douyin.com/video/300",
      ].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-https", status: "pending" });
    const getJob = vi.fn<BackendClient["getJob"]>().mockResolvedValue(
      buildJob({ jobId: "job-https", status: "pending" }),
    );
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
      concurrencyLimit: 1,
    });

    runner.start(parseResult.rows);
    await vi.runAllTicks();

    const snapshot = runner.getSnapshot();
    expect(createDownloadJob).toHaveBeenCalledTimes(1);
    expect(createDownloadJob).toHaveBeenNthCalledWith(1, { url: "https://www.douyin.com/video/300" });
    expect(snapshot.rows[0]).toEqual(expect.objectContaining({ status: "skipped", skipReason: "unsupported_host" }));
    expect(snapshot.rows[1]).toEqual(expect.objectContaining({ status: "skipped", skipReason: "unsupported_host" }));
    expect(snapshot.rows[2]).toEqual(expect.objectContaining({ status: "running", lastJobId: "job-https" }));
  });

  it("polls submitted jobs to success and failed terminal states with aggregate totals", async () => {
    const parseResult = parseBatchQueueInput(
      ["https://www.douyin.com/video/100", "https://www.douyin.com/video/200"].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-1", status: "pending" })
      .mockResolvedValueOnce({ jobId: "job-2", status: "pending" });
    const jobStates = new Map<string, JobState[]>([
      [
        "job-1",
        [
          buildJob({ jobId: "job-1", status: "pending" }),
          buildJob({ jobId: "job-1", status: "success", finishedAt: "2026-05-08T00:01:00Z" }),
        ],
      ],
      [
        "job-2",
        [
          buildJob({ jobId: "job-2", status: "running", startedAt: "2026-05-08T00:00:30Z" }),
          buildJob({ jobId: "job-2", status: "failed", error: "backend rejected", finishedAt: "2026-05-08T00:01:10Z" }),
        ],
      ],
    ]);
    const getJob = vi.fn<BackendClient["getJob"]>().mockImplementation(async (jobId) => {
      const sequence = jobStates.get(jobId);
      if (sequence === undefined || sequence.length === 0) {
        return buildJob({ jobId, status: "success" });
      }
      const next = sequence.shift();
      if (next === undefined) {
        return buildJob({ jobId, status: "success" });
      }
      return next;
    });
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
    });

    runner.start(parseResult.rows);
    await vi.runAllTimersAsync();

    const snapshot = runner.getSnapshot();
    expect(snapshot.rows[0]).toEqual(expect.objectContaining({ status: "success", currentJobId: null, retryEligible: false }));
    expect(snapshot.rows[1]).toEqual(
      expect.objectContaining({
        status: "failed",
        currentJobId: null,
        retryEligible: true,
        lastError: "backend rejected",
      }),
    );
    expect(snapshot.totals.waiting).toBe(0);
    expect(snapshot.totals.running).toBe(0);
    expect(snapshot.totals.success).toBe(1);
    expect(snapshot.totals.failed).toBe(1);
    expect(snapshot.totals.retryEligible).toBe(1);
  });

  it("marks submit failures as failed and keeps scheduling remaining rows", async () => {
    const parseResult = parseBatchQueueInput(
      ["https://www.douyin.com/video/100", "https://www.douyin.com/video/200"].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockRejectedValueOnce(new Error("submit failed"))
      .mockResolvedValueOnce({ jobId: "job-2", status: "pending" });
    const getJob = vi
      .fn<BackendClient["getJob"]>()
      .mockResolvedValueOnce(buildJob({ jobId: "job-2", status: "success", finishedAt: "2026-05-08T00:02:00Z" }));
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
    });

    runner.start(parseResult.rows);
    await vi.runAllTimersAsync();

    const snapshot = runner.getSnapshot();
    expect(createDownloadJob).toHaveBeenCalledTimes(2);
    expect(snapshot.rows[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        retryEligible: true,
        currentJobId: null,
        lastError: "submit failed",
      }),
    );
    expect(snapshot.rows[1]).toEqual(expect.objectContaining({ status: "success", retryEligible: false, currentJobId: null }));
  });

  it("marks poll failures as failed with retry eligibility", async () => {
    const parseResult = parseBatchQueueInput("https://www.douyin.com/video/100");
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-1", status: "pending" });
    const getJob = vi.fn<BackendClient["getJob"]>().mockRejectedValueOnce(new Error("poll timeout"));
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
    });

    runner.start(parseResult.rows);
    await vi.runAllTimersAsync();

    const snapshot = runner.getSnapshot();
    expect(snapshot.rows[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        retryEligible: true,
        currentJobId: null,
        lastError: "poll timeout",
      }),
    );
    expect(snapshot.totals.failed).toBe(1);
  });

  it("guards a row from duplicate in-flight submissions before create job resolves", async () => {
    const parseResult = parseBatchQueueInput("https://www.douyin.com/video/100");
    const deferred = createDeferred<{ jobId: string; status: "pending" }>();
    const createDownloadJob = vi.fn<BackendClient["createDownloadJob"]>().mockReturnValueOnce(deferred.promise);
    const getJob = vi
      .fn<BackendClient["getJob"]>()
      .mockResolvedValueOnce(buildJob({ jobId: "job-1", status: "success", finishedAt: "2026-05-08T00:02:00Z" }));
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
    });

    runner.start(parseResult.rows);
    await vi.runAllTicks();
    runner.setSchedulingEnabled(true);
    runner.setSchedulingEnabled(true);
    await vi.runAllTicks();

    expect(createDownloadJob).toHaveBeenCalledTimes(1);

    deferred.resolve({ jobId: "job-1", status: "pending" });
    await vi.runAllTimersAsync();

    const snapshot = runner.getSnapshot();
    expect(snapshot.rows[0]).toEqual(expect.objectContaining({ lastJobId: "job-1", attempt: 1 }));
  });

  it("ignores stale submit completion from queue A after queue B rebuild/start", async () => {
    const queueA = parseBatchQueueInput("https://www.douyin.com/video/100");
    const queueB = parseBatchQueueInput("https://www.douyin.com/video/200");
    const queueADeferred = createDeferred<{ jobId: string; status: "pending" }>();
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockReturnValueOnce(queueADeferred.promise)
      .mockResolvedValueOnce({ jobId: "job-b", status: "pending" });
    const getJob = vi.fn<BackendClient["getJob"]>().mockResolvedValue(
      buildJob({ jobId: "job-b", status: "pending" }),
    );
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
      concurrencyLimit: 1,
    });

    runner.start(queueA.rows);
    await vi.runAllTicks();
    runner.start(queueB.rows);
    await vi.runAllTicks();

    queueADeferred.resolve({ jobId: "job-a", status: "pending" });
    await vi.runAllTicks();

    const snapshot = runner.getSnapshot();
    expect(createDownloadJob).toHaveBeenCalledTimes(2);
    expect(createDownloadJob).toHaveBeenNthCalledWith(1, { url: "https://www.douyin.com/video/100" });
    expect(createDownloadJob).toHaveBeenNthCalledWith(2, { url: "https://www.douyin.com/video/200" });
    expect(snapshot.rows[0]).toEqual(
      expect.objectContaining({
        sourceText: "https://www.douyin.com/video/200",
        currentJobId: "job-b",
        lastJobId: "job-b",
        status: "running",
        lastError: null,
      }),
    );
  });

  it("ignores stale poll completion from queue A after queue stop and queue B restart", async () => {
    const queueA = parseBatchQueueInput("https://www.douyin.com/video/100");
    const queueB = parseBatchQueueInput("https://www.douyin.com/video/200");
    const pollADeferred = createDeferred<JobState>();
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-shared", status: "pending" })
      .mockResolvedValueOnce({ jobId: "job-shared", status: "pending" });
    const getJob = vi
      .fn<BackendClient["getJob"]>()
      .mockReturnValueOnce(pollADeferred.promise)
      .mockResolvedValue(buildJob({ jobId: "job-shared", status: "pending" }));
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
      concurrencyLimit: 1,
    });

    runner.start(queueA.rows);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1000);

    runner.stop();
    runner.start(queueB.rows);
    await vi.runAllTicks();

    pollADeferred.resolve(
      buildJob({
        jobId: "job-shared",
        status: "failed",
        error: "stale queue A failure",
        finishedAt: "2026-05-08T00:20:00Z",
      }),
    );
    await vi.runAllTicks();

    const snapshot = runner.getSnapshot();
    expect(snapshot.rows[0]).toEqual(
      expect.objectContaining({
        sourceText: "https://www.douyin.com/video/200",
        status: "running",
        currentJobId: "job-shared",
        lastError: null,
      }),
    );
  });

  it("pauses new scheduling while active jobs continue polling to terminal state", async () => {
    const parseResult = parseBatchQueueInput(
      [
        "https://www.douyin.com/video/100",
        "https://www.douyin.com/video/200",
        "https://www.douyin.com/video/300",
      ].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-1", status: "pending" });
    const getJob = vi
      .fn<BackendClient["getJob"]>()
      .mockResolvedValueOnce(buildJob({ jobId: "job-1", status: "pending" }))
      .mockResolvedValueOnce(buildJob({ jobId: "job-1", status: "success", finishedAt: "2026-05-08T00:10:00Z" }));
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
      concurrencyLimit: 1,
    });

    runner.start(parseResult.rows);
    await vi.runAllTicks();
    runner.pause();
    await vi.runAllTimersAsync();

    const snapshot = runner.getSnapshot();
    expect(createDownloadJob).toHaveBeenCalledTimes(1);
    expect(snapshot.schedulingEnabled).toBe(false);
    expect(snapshot.rows[0]).toEqual(expect.objectContaining({ status: "success" }));
    expect(snapshot.rows[1]).toEqual(expect.objectContaining({ status: "waiting", currentJobId: null }));
    expect(snapshot.rows[2]).toEqual(expect.objectContaining({ status: "waiting", currentJobId: null }));
    expect(snapshot.totals.waiting).toBe(2);
    expect(snapshot.totals.success).toBe(1);
  });

  it("resumes scheduling and starts remaining waiting rows", async () => {
    const parseResult = parseBatchQueueInput(
      ["https://www.douyin.com/video/100", "https://www.douyin.com/video/200"].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockResolvedValueOnce({ jobId: "job-1", status: "pending" })
      .mockResolvedValueOnce({ jobId: "job-2", status: "pending" });
    const getJob = vi.fn<BackendClient["getJob"]>().mockImplementation(async (jobId) => {
      return buildJob({
        jobId,
        status: "success",
        finishedAt: "2026-05-08T00:11:00Z",
      });
    });
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
      concurrencyLimit: 1,
    });

    runner.start(parseResult.rows);
    await vi.runAllTicks();
    runner.pause();
    await vi.runAllTimersAsync();
    runner.resume();
    await vi.runAllTimersAsync();

    const snapshot = runner.getSnapshot();
    expect(createDownloadJob).toHaveBeenCalledTimes(2);
    expect(snapshot.schedulingEnabled).toBe(true);
    expect(snapshot.rows[0]).toEqual(expect.objectContaining({ status: "success" }));
    expect(snapshot.rows[1]).toEqual(expect.objectContaining({ status: "success" }));
  });

  it("retries only row-model eligible terminal rows and never in-flight rows", async () => {
    const parseResult = parseBatchQueueInput(
      [
        "https://www.douyin.com/video/100",
        "https://www.douyin.com/video/100",
        "https://www.douyin.com/video/200",
      ].join("\n"),
    );
    const createDownloadJob = vi
      .fn<BackendClient["createDownloadJob"]>()
      .mockRejectedValueOnce(new Error("submit failed"))
      .mockResolvedValueOnce({ jobId: "job-2", status: "pending" })
      .mockResolvedValueOnce({ jobId: "job-3", status: "pending" });
    const getJob = vi.fn<BackendClient["getJob"]>().mockResolvedValue(
      buildJob({
        status: "success",
        finishedAt: "2026-05-08T00:12:00Z",
      }),
    );
    const runner = createBatchQueueRunner({
      backendClient: {
        createDownloadJob,
        getJob,
      } satisfies Pick<BackendClient, "createDownloadJob" | "getJob">,
      concurrencyLimit: 1,
    });

    runner.start(parseResult.rows);
    await vi.runAllTimersAsync();

    const beforeRetry = runner.getSnapshot();
    expect(beforeRetry.rows[0]).toEqual(expect.objectContaining({ status: "failed", retryEligible: true }));
    expect(beforeRetry.rows[1]).toEqual(expect.objectContaining({ status: "skipped", retryEligible: false, skipReason: "duplicate" }));
    expect(beforeRetry.rows[2]).toEqual(expect.objectContaining({ status: "success" }));

    const retriedCount = runner.retryEligibleRows();
    expect(retriedCount).toBe(1);
    expect(createDownloadJob).toHaveBeenCalledTimes(3);

    const duringRetry = runner.getSnapshot();
    expect(duringRetry.rows[0]).toEqual(expect.objectContaining({ status: "running", retryEligible: false }));
    expect(duringRetry.rows[1]).toEqual(expect.objectContaining({ status: "skipped", retryEligible: false }));
    expect(duringRetry.rows[2]).toEqual(expect.objectContaining({ status: "success", lastJobId: "job-2" }));

    const retriedAgain = runner.retryEligibleRows();
    expect(retriedAgain).toBe(0);
    expect(createDownloadJob).toHaveBeenCalledTimes(3);

    await vi.runAllTimersAsync();
    const finalSnapshot = runner.getSnapshot();
    expect(finalSnapshot.rows[0]).toEqual(expect.objectContaining({ status: "success", attempt: 2, lastJobId: "job-3" }));
    expect(finalSnapshot.totals.failed).toBe(0);
    expect(finalSnapshot.totals.retryEligible).toBe(0);
  });

});

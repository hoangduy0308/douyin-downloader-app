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
});

import { vi } from "vitest";
import type { BackendClient, JobState } from "../services/backendClient";
import { createJobPoller } from "../services/jobPolling";

function buildJob(job: Partial<JobState>): JobState {
  return {
    jobId: "job-1",
    status: "pending",
    submittedAt: "2026-05-08T00:00:00Z",
    startedAt: null,
    finishedAt: null,
    counts: {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
    },
    error: null,
    ...job,
  };
}

describe("jobPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls pending and running states, then stops after success", async () => {
    const getJob = vi
      .fn<BackendClient["getJob"]>()
      .mockResolvedValueOnce(buildJob({ status: "pending", counts: { total: 3, success: 0, failed: 0, skipped: 0 } }))
      .mockResolvedValueOnce(buildJob({ status: "running", counts: { total: 3, success: 1, failed: 0, skipped: 0 } }))
      .mockResolvedValueOnce(buildJob({ status: "success", counts: { total: 3, success: 3, failed: 0, skipped: 0 } }));
    const onJob = vi.fn();
    const onError = vi.fn();
    const poller = createJobPoller({
      jobId: "job-1",
      backendClient: { getJob } as Pick<BackendClient, "getJob">,
      onJob,
      onError,
      pollIntervalMs: 1000,
    });

    poller.start();
    await vi.runAllTimersAsync();

    expect(onError).not.toHaveBeenCalled();
    expect(onJob).toHaveBeenCalledTimes(3);
    expect(onJob).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: "pending" }));
    expect(onJob).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: "running" }));
    expect(onJob).toHaveBeenNthCalledWith(3, expect.objectContaining({ status: "success" }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling after failed terminal status", async () => {
    const getJob = vi
      .fn<BackendClient["getJob"]>()
      .mockResolvedValueOnce(buildJob({ status: "failed", error: "Unsupported URL", counts: { total: 1, success: 0, failed: 1, skipped: 0 } }));
    const onJob = vi.fn();
    const onError = vi.fn();
    const poller = createJobPoller({
      jobId: "job-1",
      backendClient: { getJob } as Pick<BackendClient, "getJob">,
      onJob,
      onError,
      pollIntervalMs: 1000,
    });

    poller.start();
    await vi.runAllTimersAsync();

    expect(onJob).toHaveBeenCalledTimes(1);
    expect(onJob).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports 404 unknown job errors and stops polling", async () => {
    const onJob = vi.fn();
    const onError = vi.fn();
    const getJob = vi.fn<BackendClient["getJob"]>().mockRejectedValueOnce(new Error("404 not found"));
    const poller = createJobPoller({
      jobId: "job-404",
      backendClient: { getJob } as Pick<BackendClient, "getJob">,
      onJob,
      onError,
      pollIntervalMs: 1000,
    });

    poller.start();
    await vi.runAllTimersAsync();

    expect(onJob).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports polling transport errors and stops polling", async () => {
    const onJob = vi.fn();
    const onError = vi.fn();
    const getJob = vi.fn<BackendClient["getJob"]>().mockRejectedValueOnce(new Error("network timeout"));
    const poller = createJobPoller({
      jobId: "job-timeout",
      backendClient: { getJob } as Pick<BackendClient, "getJob">,
      onJob,
      onError,
      pollIntervalMs: 1000,
    });

    poller.start();
    await vi.runAllTimersAsync();

    expect(onJob).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

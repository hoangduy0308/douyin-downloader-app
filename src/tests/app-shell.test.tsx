import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";

  const mocks = vi.hoisted(() => ({
  createDownloadJobMock: vi.fn(),
  getJobMock: vi.fn(),
  runtimeAvailable: false,
  lifecycleStartMock: vi.fn(),
  openOutputFolderMock: vi.fn(),
  captureAndCommitCookiesMock: vi.fn(),
    ensureRuntimeDirectoryMock: vi.fn(),
    writeManagedConfigAtomicMock: vi.fn(),
    resolveManagedConfigPathMock: vi.fn(),
    readImportedBatchTextMock: vi.fn(),
  }));

const OUTPUT_PATH_STORAGE_KEY = "douyin-downloader-app.output-path";

vi.mock("../services/backendClient", () => ({
  createBackendClient: () => ({
    health: vi.fn(),
    createDownloadJob: mocks.createDownloadJobMock,
    getJob: mocks.getJobMock,
    listJobs: vi.fn(),
  }),
}));

vi.mock("../services/tauriBackendRuntime", () => ({
  isTauriRuntimeAvailable: () => mocks.runtimeAvailable,
  openOutputFolder: (path: string) => mocks.openOutputFolderMock(path),
  captureAndCommitCookies: (request: unknown) => mocks.captureAndCommitCookiesMock(request),
    ensureRuntimeDirectory: (path: string) => mocks.ensureRuntimeDirectoryMock(path),
    writeManagedConfigAtomic: (path: string, contents: string) =>
      mocks.writeManagedConfigAtomicMock(path, contents),
    resolveManagedConfigPath: (fallbackPath: string) =>
      mocks.resolveManagedConfigPathMock(fallbackPath),
    TauriBackendRuntime: class {},
  }));

vi.mock("../services/batchImportAdapter", () => ({
  readImportedBatchText: () => mocks.readImportedBatchTextMock(),
}));

vi.mock("../services/backendLifecycle", () => {
  class MockBackendLifecycle {
    public async start(config: unknown): Promise<{ state: "ready"; detail: string }> {
      return mocks.lifecycleStartMock(config);
    }

    public async stop(): Promise<void> {}

    public getDiagnostics(): Array<{ message: string }> {
      return [];
    }
  }

  return {
    BackendLifecycle: MockBackendLifecycle,
    probeBackendHealth: vi.fn(),
    wait: vi.fn(async () => undefined),
  };
});

import { App } from "../app/App";

  describe("App shell", () => {
    beforeEach(() => {
    vi.useRealTimers();
    mocks.runtimeAvailable = false;
    mocks.createDownloadJobMock.mockReset();
    mocks.getJobMock.mockReset();
      mocks.lifecycleStartMock.mockReset();
      mocks.openOutputFolderMock.mockReset();
      mocks.captureAndCommitCookiesMock.mockReset();
        mocks.ensureRuntimeDirectoryMock.mockReset();
        mocks.writeManagedConfigAtomicMock.mockReset();
        mocks.resolveManagedConfigPathMock.mockReset();
        mocks.readImportedBatchTextMock.mockReset();
    mocks.lifecycleStartMock.mockResolvedValue({
      state: "ready",
      detail: "Backend is ready.",
    });
      mocks.openOutputFolderMock.mockResolvedValue(undefined);
      mocks.captureAndCommitCookiesMock.mockResolvedValue({
        status: "missing-runtime",
        exitCode: null,
        diagnostics: ["Tauri runtime is unavailable."],
        cookies: null,
        error: "tauri-runtime-unavailable",
      });
        mocks.ensureRuntimeDirectoryMock.mockResolvedValue(undefined);
        mocks.writeManagedConfigAtomicMock.mockResolvedValue(undefined);
        mocks.resolveManagedConfigPathMock.mockResolvedValue(
          "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
        );
        mocks.readImportedBatchTextMock.mockResolvedValue("");
        window.localStorage.clear();
    });

  it("renders first-screen workflow controls with single and batch tabs", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Douyin Downloader" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Single" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Batch" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Logs" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Backend readiness" })).toBeInTheDocument();
  expect(screen.getByLabelText("Download location")).toBeInTheDocument();
  expect(screen.getByLabelText("Douyin URL")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start download" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Active job status" })).toBeInTheDocument();
    });

    it("keeps advanced controls collapsed by default and expands on demand", () => {
      render(<App />);

      const toggle = screen.getByRole("button", { name: "Advanced controls" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByLabelText("Music assets")).not.toBeInTheDocument();

      fireEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("Music assets")).toBeInTheDocument();
      expect(screen.getByLabelText("Retry count")).toBeInTheDocument();
      expect(screen.queryByLabelText("Transcript")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Comments")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Live")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
    });

  it("loads persisted output folder before starting managed backend lifecycle", async () => {
    mocks.runtimeAvailable = true;
    window.localStorage.setItem(OUTPUT_PATH_STORAGE_KEY, "D:\\Persisted\\Downloads");

      render(<App />);

      await waitFor(() => {
        expect(screen.getByLabelText("Download location")).toHaveValue("D:\\Persisted\\Downloads");
      });
      await waitFor(() => {
        expect(mocks.lifecycleStartMock).toHaveBeenCalledWith(
          expect.objectContaining({
            outputPath: "D:\\Persisted\\Downloads",
          }),
      );
      });
  });

  it("starts tauri runtime with portable managed-sidecar mode instead of workstation dev paths", async () => {
    mocks.runtimeAvailable = true;

    render(<App />);

    await waitFor(() => {
      expect(mocks.lifecycleStartMock).toHaveBeenCalledTimes(1);
    });

    const firstStartConfig = mocks.lifecycleStartMock.mock.calls[0]?.[0] as {
      mode: string;
      configPath: string;
      backendRoot?: string;
    };
    expect(firstStartConfig).toEqual(
      expect.objectContaining({
        mode: "managed-sidecar",
      }),
    );
    expect(firstStartConfig.configPath).toContain("managed-config.yml");
    expect(firstStartConfig.configPath).not.toContain("F:\\Work\\DouyinDownload");
    expect(firstStartConfig.backendRoot).toBeUndefined();
  });

  it("waits for initial managed config write before starting backend lifecycle", async () => {
    mocks.runtimeAvailable = true;
    let releaseConfigWrite: (() => void) | null = null;
      mocks.writeManagedConfigAtomicMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseConfigWrite = () => resolve();
          }),
      );

    render(<App />);

    await waitFor(() => {
      expect(mocks.writeManagedConfigAtomicMock).toHaveBeenCalled();
    });
    expect(mocks.lifecycleStartMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start download" })).toBeDisabled();
    expect(screen.getByText("Start is disabled while runtime settings are initializing.")).toBeInTheDocument();

    const triggerConfigWrite = releaseConfigWrite as unknown as () => void;
    triggerConfigWrite();

    await waitFor(() => {
      expect(mocks.lifecycleStartMock).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps submit blocked when runtime settings initialization fails", async () => {
    mocks.runtimeAvailable = true;
    mocks.writeManagedConfigAtomicMock.mockRejectedValue(new Error("disk-full"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Start is disabled because runtime settings failed to initialize.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Start download" })).toBeDisabled();
    expect(mocks.lifecycleStartMock).not.toHaveBeenCalled();
  });

  it("writes scoped advanced controls into managed config without deferred keys", async () => {
    render(<App />);

      fireEvent.click(screen.getByRole("button", { name: "Advanced controls" }));
      fireEvent.change(screen.getByLabelText("Retry count"), {
        target: { value: "6" },
      });

      await waitFor(() => {
        expect(mocks.writeManagedConfigAtomicMock).toHaveBeenCalled();
      });
      const latestCall =
        mocks.writeManagedConfigAtomicMock.mock.calls[mocks.writeManagedConfigAtomicMock.mock.calls.length - 1];
      const latestYaml = latestCall[1] as string;

      expect(latestYaml).toContain("retry_times: 6");
      expect(latestYaml).toContain("browser_fallback:");
      expect(latestYaml).not.toContain("comments:");
      expect(latestYaml).not.toContain("transcript:");
      expect(latestYaml).not.toContain("live:");
      expect(latestYaml).not.toContain("notifications:");
      expect(latestYaml).not.toContain("server:");
      expect(latestYaml).not.toContain("allmix");
    });

  it("builds queue rows from pasted multiline urls while preserving equal-weight mode controls", () => {
    render(<App />);
    const singleTab = screen.getByRole("tab", { name: "Single" });
    const batchTab = screen.getByRole("tab", { name: "Batch" });

    expect(singleTab).toHaveAttribute("aria-selected", "true");
    expect(batchTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(batchTab);

    expect(singleTab).toHaveAttribute("aria-selected", "false");
    expect(batchTab).toHaveAttribute("aria-selected", "true");

    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: [
          "https://www.douyin.com/video/1",
          "https://www.example.com/video/2",
          "https://www.iesdouyin.com/share/video/3",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));

    const batchPanel = screen.getByRole("region", { name: "Batch download panel" });
    expect(within(batchPanel).getByText("Queue built: 2 ready, 1 skipped.")).toBeInTheDocument();
    expect(within(batchPanel).getAllByRole("row").length).toBe(4);
    expect(within(batchPanel).getByText("unsupported host")).toBeInTheDocument();
  });

  it("imports text through adapter boundary and renders invalid rows as skipped", async () => {
    mocks.readImportedBatchTextMock.mockResolvedValueOnce(
      [
        "https://www.douyin.com/video/100",
        "not-a-url",
      ].join("\n"),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Import URLs" }));

    await waitFor(() => {
      expect(mocks.readImportedBatchTextMock).toHaveBeenCalledTimes(1);
    });

    const batchPanel = screen.getByRole("region", { name: "Batch download panel" });
    expect(within(batchPanel).getByText("Queue built: 1 ready, 1 skipped.")).toBeInTheDocument();
    expect(within(batchPanel).getAllByRole("row").length).toBe(3);
    expect(within(batchPanel).getByText("invalid URL")).toBeInTheDocument();
  });

  it("starts batch queue through runner and shows active row/job with aggregate totals", async () => {
    mocks.createDownloadJobMock
      .mockResolvedValueOnce({
        jobId: "batch-job-1",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-2",
        status: "pending",
      });
    mocks.getJobMock.mockResolvedValue({
      jobId: "batch-job-1",
      status: "pending",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: null,
      finishedAt: null,
      counts: {
        total: 1,
        success: 0,
        failed: 0,
        skipped: 0,
      },
      error: null,
    });

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: [
          "https://www.douyin.com/video/100",
          "https://www.example.com/video/200",
          "https://www.iesdouyin.com/share/video/300",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(2);
    });
    expect(mocks.createDownloadJobMock).toHaveBeenNthCalledWith(1, {
      url: "https://www.douyin.com/video/100",
    });
    expect(mocks.createDownloadJobMock).toHaveBeenNthCalledWith(2, {
      url: "https://www.iesdouyin.com/share/video/300",
    });

    const batchPanel = screen.getByRole("region", { name: "Batch download panel" });
    const statusPanel = within(batchPanel).getByRole("region", { name: "Batch queue status" });
    expect(within(statusPanel).getByText("Queue status")).toBeInTheDocument();
    expect(within(statusPanel).getByText("Running", { selector: "strong" })).toBeInTheDocument();
    expect(within(statusPanel).getByText("Active URL")).toBeInTheDocument();
    expect(
      within(statusPanel).getByText("https://www.douyin.com/video/100", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(within(statusPanel).getByText("Active job")).toBeInTheDocument();
    expect(within(statusPanel).getByText("batch-job-1", { selector: "strong" })).toBeInTheDocument();
    expect(within(batchPanel).getAllByText("batch-job-2").length).toBeGreaterThanOrEqual(1);
    expect(within(statusPanel).getByText("Skipped")).toBeInTheDocument();
    const totalsPanel = within(statusPanel).getByLabelText("Batch queue totals");
    const skippedTotalsCell = within(totalsPanel).getByText("Skipped").closest("div");
    expect(skippedTotalsCell).not.toBeNull();
    expect(within(skippedTotalsCell as HTMLDivElement).getByText("1")).toBeInTheDocument();
  });

  it("pauses new batch starts while active jobs continue to finish, then resumes waiting rows", async () => {
    mocks.createDownloadJobMock
      .mockResolvedValueOnce({
        jobId: "batch-job-1",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-2",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-3",
        status: "pending",
      });
    mocks.getJobMock.mockImplementation(async (jobId: string) => ({
      jobId,
      status: "success",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 1,
        failed: 0,
        skipped: 0,
      },
      error: null,
    }));

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: [
          "https://www.douyin.com/video/101",
          "https://www.douyin.com/video/102",
          "https://www.douyin.com/video/103",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("button", { name: "Pause queue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Pause queue" }));

    expect(screen.getByText("Queue paused. Active jobs continue polling to terminal state.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause queue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume queue" })).toBeEnabled();

    await waitFor(
      () => {
        expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 2500 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume queue" }));
    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(3);
    });
  });

  it("enables retry only for eligible terminal rows and never retries parser-skipped duplicates", async () => {
    mocks.createDownloadJobMock
      .mockRejectedValueOnce(new Error("submit failed"))
      .mockResolvedValueOnce({
        jobId: "batch-job-retry",
        status: "pending",
      });
    mocks.getJobMock.mockResolvedValue({
      jobId: "batch-job-retry",
      status: "success",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 1,
        failed: 0,
        skipped: 0,
      },
      error: null,
    });

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: [
          "https://www.douyin.com/video/retry-me",
          "https://www.douyin.com/video/retry-me",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
    expect(screen.getByRole("button", { name: "Retry failed" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Download failed. Check diagnostics for technical details. Use Retry failed to try this row again.",
        ),
      ).toBeInTheDocument();
    });
    expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("batch-diagnostics-cache")).toHaveTextContent("submit failed");
    expect(screen.getByRole("button", { name: "Retry failed" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    expect(screen.getByRole("button", { name: "Retry failed" })).toBeDisabled();

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(2);
    });
  });

  it("retries only the selected failed row from row action and does not resubmit unrelated failed rows", async () => {
    mocks.createDownloadJobMock
      .mockResolvedValueOnce({
        jobId: "batch-job-a",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-b",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-a-retry",
        status: "pending",
      });
    mocks.getJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "batch-job-a") {
        return {
          jobId,
          status: "failed",
          submittedAt: "2026-05-08T03:00:00Z",
          startedAt: "2026-05-08T03:00:01Z",
          finishedAt: "2026-05-08T03:00:03Z",
          counts: {
            total: 1,
            success: 0,
            failed: 1,
            skipped: 0,
          },
          error: "RuntimeError: first row failed",
        };
      }
      if (jobId === "batch-job-b") {
        return {
          jobId,
          status: "failed",
          submittedAt: "2026-05-08T03:00:00Z",
          startedAt: "2026-05-08T03:00:01Z",
          finishedAt: "2026-05-08T03:00:03Z",
          counts: {
            total: 1,
            success: 0,
            failed: 1,
            skipped: 0,
          },
          error: "RuntimeError: second row failed",
        };
      }
      return {
        jobId,
        status: "success",
        submittedAt: "2026-05-08T03:00:00Z",
        startedAt: "2026-05-08T03:00:01Z",
        finishedAt: "2026-05-08T03:00:03Z",
        counts: {
          total: 1,
          success: 1,
          failed: 0,
          skipped: 0,
        },
        error: null,
      };
    });

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: [
          "https://www.douyin.com/video/retry-only-row-1",
          "https://www.douyin.com/video/keep-row-2-failed",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry failed" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Retry row 1" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry row 1" }));

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(3);
    });
    expect(mocks.createDownloadJobMock).toHaveBeenLastCalledWith({
      url: "https://www.douyin.com/video/retry-only-row-1",
    });

    await waitFor(() => {
      expect(screen.getByText("Batch finished: 1 succeeded, 1 failed, 0 skipped.")).toBeInTheDocument();
    });
  });

  it("shows terminal batch summary from row states after retry and reuses open-folder action", async () => {
    mocks.createDownloadJobMock
      .mockResolvedValueOnce({
        jobId: "batch-job-a",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-b",
        status: "pending",
      })
      .mockResolvedValueOnce({
        jobId: "batch-job-a-retry",
        status: "pending",
      });
    mocks.getJobMock.mockImplementation(async (jobId: string) => {
      if (jobId === "batch-job-a") {
        return {
          jobId,
          status: "failed",
          submittedAt: "2026-05-08T03:00:00Z",
          startedAt: "2026-05-08T03:00:01Z",
          finishedAt: "2026-05-08T03:00:03Z",
          counts: {
            total: 1,
            success: 0,
            failed: 1,
            skipped: 0,
          },
          error: "RuntimeError: cookie expired",
        };
      }
      return {
        jobId,
        status: "success",
        submittedAt: "2026-05-08T03:00:00Z",
        startedAt: "2026-05-08T03:00:01Z",
        finishedAt: "2026-05-08T03:00:03Z",
        counts: {
          total: 1,
          success: 1,
          failed: 0,
          skipped: 0,
        },
        error: null,
      };
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Download location"), {
      target: { value: "D:\\Media\\DouyinDownloads" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: [
          "https://www.douyin.com/video/fail-then-retry",
          "not-a-url",
          "https://www.iesdouyin.com/share/video/success",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

    expect(screen.queryByText("Batch finished: 1 succeeded, 1 failed, 1 skipped.")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("Batch finished: 1 succeeded, 1 failed, 1 skipped.")).toBeInTheDocument();
    });

    const batchPanel = screen.getByRole("region", { name: "Batch download panel" });
    expect(within(batchPanel).getByText("invalid URL")).toBeInTheDocument();
    expect(
      within(batchPanel).getByText(
        "Douyin login cookies may be missing or expired. Fetch cookies again, or use manual/import cookies, then retry the download. Use Retry failed to try this row again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("batch-diagnostics-cache")).toHaveTextContent("RuntimeError: cookie expired");

    fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(screen.getByText("Batch finished: 2 succeeded, 0 failed, 1 skipped.")).toBeInTheDocument();
    });

    fireEvent.click(within(batchPanel).getByRole("button", { name: "Open output folder" }));
    await waitFor(() => {
      expect(mocks.openOutputFolderMock).toHaveBeenCalledWith("D:\\Media\\DouyinDownloads");
    });
  });

  it("shows required validation for blank single URL submit", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    expect(screen.getByText("Enter a Douyin URL before starting download.")).toBeInTheDocument();
    expect(mocks.createDownloadJobMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported non-douyin URLs before submit", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.example.com/video/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    expect(
      screen.getByText("Only Douyin and iesdouyin links are supported in this phase."),
    ).toBeInTheDocument();
    expect(mocks.createDownloadJobMock).not.toHaveBeenCalled();
  });

  it("rejects lookalike douyin hostnames before submit", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://douyin.com.evil.test/video/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    expect(
      screen.getByText("Only Douyin and iesdouyin links are supported in this phase."),
    ).toBeInTheDocument();
    expect(mocks.createDownloadJobMock).not.toHaveBeenCalled();
  });

  it("submits accepted douyin URLs and stores active job id", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-123",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-123",
      status: "pending",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: null,
      finishedAt: null,
      counts: {
        total: 3,
        success: 0,
        failed: 0,
        skipped: 0,
      },
      error: null,
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(mocks.createDownloadJobMock).toHaveBeenCalledWith({
        url: "https://www.douyin.com/video/123",
      });
    });

    expect(screen.getByText("Download queued as job-123.")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Active job id: job-123")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });

  it("disables submit while backend is not ready", () => {
    mocks.runtimeAvailable = true;
    mocks.lifecycleStartMock.mockImplementation(
      () =>
        new Promise(() => {
          // keep pending
        }),
    );

    render(<App />);

    expect(screen.getByRole("button", { name: "Start download" })).toBeDisabled();
    expect(screen.getByText(/Start is disabled while (runtime settings are initializing|backend readiness is pending)\./)).toBeInTheDocument();
  });

  it("disables submit while config version is waiting for backend restart", async () => {
    mocks.runtimeAvailable = true;
    mocks.lifecycleStartMock
      .mockResolvedValueOnce({
        state: "ready",
        detail: "Backend is ready.",
      })
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            // keep pending
          }),
      );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start download" })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText("Download location"), {
      target: { value: "C:\\DouyinDownloads\\next" },
    });

    expect(screen.getByRole("button", { name: "Start download" })).toBeDisabled();
    expect(
      screen.getByText("Start is disabled while backend restarts with updated runtime settings."),
    ).toBeInTheDocument();
  });

  it("blocks submit while backend restarts after advanced settings change", async () => {
    mocks.runtimeAvailable = true;
    mocks.lifecycleStartMock
      .mockResolvedValueOnce({
        state: "ready",
        detail: "Backend is ready.",
      })
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            // keep pending
          }),
      );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start download" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Advanced controls" }));
    fireEvent.click(screen.getByLabelText("Music assets"));

    await waitFor(() => {
      expect(mocks.writeManagedConfigAtomicMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("button", { name: "Start download" })).toBeDisabled();
    expect(
      screen.getByText("Start is disabled while backend restarts with updated runtime settings."),
    ).toBeInTheDocument();
  });

  it("shows friendly submit failure when backend submission fails", async () => {
    mocks.createDownloadJobMock.mockRejectedValueOnce(new Error("submit failed"));

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://v.douyin.com/abcdef/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not submit download. Check backend status and try again."),
      ).toBeInTheDocument();
    });
  });

    it("renders running and success counts from backend polling and stops on terminal status", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-poll",
      status: "pending",
    });
    mocks.getJobMock
      .mockResolvedValueOnce({
        jobId: "job-poll",
        status: "running",
        submittedAt: "2026-05-08T03:00:00Z",
        startedAt: "2026-05-08T03:00:01Z",
        finishedAt: null,
        counts: {
          total: 5,
          success: 2,
          failed: 1,
          skipped: 0,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        jobId: "job-poll",
        status: "success",
        submittedAt: "2026-05-08T03:00:00Z",
        startedAt: "2026-05-08T03:00:01Z",
        finishedAt: "2026-05-08T03:00:03Z",
        counts: {
          total: 5,
          success: 5,
          failed: 0,
          skipped: 0,
        },
        error: null,
      });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/polling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.getAllByText("Success").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Download finished successfully.")).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
      expect(mocks.getJobMock).toHaveBeenCalledTimes(2);
    });

    it("records single terminal success in basic history with url time status and output path", async () => {
      mocks.createDownloadJobMock.mockResolvedValueOnce({
        jobId: "job-history-single",
        status: "pending",
      });
      mocks.getJobMock.mockResolvedValueOnce({
        jobId: "job-history-single",
        status: "success",
        submittedAt: "2026-05-08T03:00:00Z",
        startedAt: "2026-05-08T03:00:01Z",
        finishedAt: "2026-05-08T03:00:03Z",
        counts: {
          total: 1,
          success: 1,
          failed: 0,
          skipped: 0,
        },
        error: null,
      });

      render(<App />);

      fireEvent.change(screen.getByLabelText("Download location"), {
        target: { value: "D:\\Media\\DouyinDownloads" },
      });
      fireEvent.change(screen.getByLabelText("Douyin URL"), {
        target: { value: "https://www.douyin.com/video/history-single" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Start download" }));

      await waitFor(() => {
        expect(screen.getByText("Download finished successfully.")).toBeInTheDocument();
      });

      const historyPanel = screen.getByRole("region", { name: "History panel" });
      expect(within(historyPanel).getByText("https://www.douyin.com/video/history-single")).toBeInTheDocument();
      expect(within(historyPanel).getByText("single")).toBeInTheDocument();
      expect(within(historyPanel).getByText("success")).toBeInTheDocument();
      expect(within(historyPanel).getByText("2026-05-08T03:00:03.000Z")).toBeInTheDocument();
      expect(within(historyPanel).getByText("D:\\Media\\DouyinDownloads")).toBeInTheDocument();
    });

    it("updates the same batch history row to final status after retry", async () => {
      mocks.createDownloadJobMock
        .mockRejectedValueOnce(new Error("submit failed for history"))
        .mockResolvedValueOnce({
          jobId: "batch-history-job-1-retry",
          status: "pending",
        });
      mocks.getJobMock.mockResolvedValueOnce({
          jobId: "batch-history-job-1-retry",
          status: "success",
          submittedAt: "2026-05-08T03:11:00Z",
          startedAt: "2026-05-08T03:11:01Z",
          finishedAt: "2026-05-08T03:11:03Z",
          counts: {
            total: 1,
            success: 1,
            failed: 0,
            skipped: 0,
          },
          error: null,
        });

      render(<App />);

      fireEvent.change(screen.getByLabelText("Download location"), {
        target: { value: "D:\\Media\\DouyinDownloads" },
      });
      fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
      fireEvent.change(screen.getByLabelText("Batch URLs"), {
        target: {
          value: "https://www.douyin.com/video/history-retry",
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
      fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Retry failed" })).toBeEnabled();
      });
      fireEvent.click(screen.getByRole("button", { name: "Retry failed" }));

      await waitFor(
        () => {
          expect(screen.getByText("Batch finished: 1 succeeded, 0 failed, 0 skipped.")).toBeInTheDocument();
        },
        { timeout: 2500 },
      );

      const historyPanel = screen.getByRole("region", { name: "History panel" });
      const matchingRows = within(historyPanel)
        .getAllByRole("listitem")
        .filter((item) => item.textContent?.includes("https://www.douyin.com/video/history-retry"));
      expect(matchingRows).toHaveLength(1);
      expect(matchingRows[0]).toHaveTextContent("batch-row");
      expect(matchingRows[0]).toHaveTextContent("success");
      expect(matchingRows[0]).not.toHaveTextContent("failed");
    });

    it("loads persisted history after app restart", async () => {
      mocks.createDownloadJobMock.mockResolvedValueOnce({
        jobId: "job-history-restart",
        status: "pending",
      });
      mocks.getJobMock.mockResolvedValueOnce({
        jobId: "job-history-restart",
        status: "success",
        submittedAt: "2026-05-08T03:20:00Z",
        startedAt: "2026-05-08T03:20:01Z",
        finishedAt: "2026-05-08T03:20:03Z",
        counts: {
          total: 1,
          success: 1,
          failed: 0,
          skipped: 0,
        },
        error: null,
      });

      const firstRender = render(<App />);

      fireEvent.change(screen.getByLabelText("Download location"), {
        target: { value: "D:\\Media\\DouyinDownloads" },
      });
      fireEvent.change(screen.getByLabelText("Douyin URL"), {
        target: { value: "https://www.douyin.com/video/history-restart" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Start download" }));

      await waitFor(() => {
        expect(screen.getByText("Download finished successfully.")).toBeInTheDocument();
      });
      expect(screen.getByText("https://www.douyin.com/video/history-restart")).toBeInTheDocument();

      firstRender.unmount();

      render(<App />);
      const historyPanel = screen.getByRole("region", { name: "History panel" });
      await waitFor(() => {
        expect(within(historyPanel).getByText("https://www.douyin.com/video/history-restart")).toBeInTheDocument();
      });
      expect(within(historyPanel).getByText("success")).toBeInTheDocument();
    });

    it("shows friendly missing-job message for polling 404 errors and keeps diagnostics separate", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-404",
      status: "pending",
    });
    mocks.getJobMock.mockRejectedValueOnce(new Error("404 job missing"));

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://v.douyin.com/abcdef/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(
        screen.getByText("This download job is no longer available. Start the download again."),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("job missing")).not.toBeInTheDocument();
    expect(screen.getByTestId("job-diagnostics-cache")).toHaveTextContent("job missing");
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    const logsPanel = screen.getByRole("region", { name: "Logs panel" });
    expect(logsPanel).toBeInTheDocument();
    expect(within(logsPanel).getByText("404 job missing")).toBeInTheDocument();
  });

  it("shows cookie recovery actions and retry guidance for single failed jobs", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-cookie-single",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-cookie-single",
      status: "failed",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
      },
      error: "401 unauthorized: cookie expired, login required",
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/cookie-single" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Douyin login cookies may be missing or expired. Fetch cookies again, or use manual/import cookies, then retry the download.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Fetch cookies again" })).toBeInTheDocument();
    expect(screen.getByText("Retry this job after cookie recovery.")).toBeInTheDocument();
    expect(screen.getByText("Manual/import cookie fallback remains available.")).toBeInTheDocument();
  });

  it("keeps cancel diagnostics in logs when cookie recovery is canceled", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-cookie-cancel",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-cookie-cancel",
      status: "failed",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
      },
      error: "cookie required: login expired",
    });
    mocks.captureAndCommitCookiesMock.mockResolvedValueOnce({
      status: "cancelled",
      exitCode: null,
      diagnostics: ["stderr: capture canceled by user"],
      cookies: null,
      error: "user canceled",
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/cookie-cancel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Fetch cookies again" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Fetch cookies again" }));

    await waitFor(() => {
      expect(
        screen.getByText("Cookie recovery was canceled. Existing cookies were unchanged."),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("job-diagnostics-cache")).toHaveTextContent("stderr: capture canceled by user");
      expect(
        mocks.captureAndCommitCookiesMock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          managedConfigPath:
            "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
        }),
      );
  });

  it("redacts sensitive cookie and authorization text in logs panel", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-cookie-redact",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-cookie-redact",
      status: "failed",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
      },
      error: "401 unauthorized: cookie expired, login required",
    });
    mocks.captureAndCommitCookiesMock.mockResolvedValueOnce({
      status: "failed",
      exitCode: 2,
      diagnostics: ["Authorization: Bearer secret-value cookie=super-secret-cookie-value"],
      cookies: null,
      error: "cookie fetch failed",
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/cookie-redact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Fetch cookies again" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Fetch cookies again" }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    const logsPanel = screen.getByRole("region", { name: "Logs panel" });
    expect(logsPanel).toHaveTextContent("[REDACTED]");
    expect(logsPanel).not.toHaveTextContent("secret-value");
    expect(logsPanel).not.toHaveTextContent("super-secret-cookie-value");
  });

  it("shows batch cookie recovery action while keeping row retry context visible", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "batch-cookie-job",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "batch-cookie-job",
      status: "failed",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
      },
      error: "401 unauthorized: cookie expired, login required",
    });

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: "Batch" }));
    fireEvent.change(screen.getByLabelText("Batch URLs"), {
      target: {
        value: "https://www.douyin.com/video/batch-cookie",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Start batch" }));

    await waitFor(
      () => {
        expect(
          screen.getByText(
            "Douyin login cookies may be missing or expired. Fetch cookies again, or use manual/import cookies, then retry the download. Use Retry failed to try this row again.",
          ),
        ).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
    expect(screen.getByRole("button", { name: "Fetch cookies again" })).toBeInTheDocument();
    expect(screen.getByText("Use Retry failed or row Retry after cookie recovery.")).toBeInTheDocument();
  });

  it("keeps generic failures generic without cookie-specific recovery actions", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-generic-failed",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-generic-failed",
      status: "failed",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
      },
      error: "Traceback: random backend error",
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/generic-failed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByText("Download failed. Check diagnostics for technical details.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Fetch cookies again" })).not.toBeInTheDocument();
  });

  it("opens the selected output folder for terminal success jobs", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-open-success",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-open-success",
      status: "success",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 1,
        failed: 0,
        skipped: 0,
      },
      error: null,
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Download location"), {
      target: { value: "D:\\Media\\DouyinDownloads" },
    });
    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/term-success" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open output folder" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open output folder" }));

    await waitFor(() => {
      expect(mocks.openOutputFolderMock).toHaveBeenCalledWith("D:\\Media\\DouyinDownloads");
    });
  });

  it("keeps open-folder action disabled when no output folder is configured", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-no-output",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-no-output",
      status: "success",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 1,
        failed: 0,
        skipped: 0,
      },
      error: null,
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Download location"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/no-output" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open output folder" })).toBeDisabled();
    });
    expect(
      screen.getByText("Choose an output folder first before opening it."),
    ).toBeInTheDocument();
    expect(mocks.openOutputFolderMock).not.toHaveBeenCalled();
  });

  it("shows friendly folder-missing message while keeping raw details in diagnostics", async () => {
    mocks.createDownloadJobMock.mockResolvedValueOnce({
      jobId: "job-open-failed",
      status: "pending",
    });
    mocks.getJobMock.mockResolvedValueOnce({
      jobId: "job-open-failed",
      status: "failed",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: "2026-05-08T03:00:03Z",
      counts: {
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
      },
      error: "RuntimeError: cookie expired",
    });
    mocks.openOutputFolderMock.mockRejectedValueOnce(
      new Error("Output folder path does not exist: C:\\Missing\\DouyinDownloads"),
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText("Download location"), {
      target: { value: "C:\\Missing\\DouyinDownloads" },
    });
    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://www.douyin.com/video/fail-open" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open output folder" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open output folder" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "The selected output folder is missing. Recreate it or choose a different folder.",
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Output folder path does not exist")).not.toBeInTheDocument();
    expect(screen.getByTestId("job-diagnostics-cache")).toHaveTextContent(
      "Output folder path does not exist: C:\\Missing\\DouyinDownloads",
    );
  });
});

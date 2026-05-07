import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDownloadJobMock: vi.fn(),
  getJobMock: vi.fn(),
  runtimeAvailable: false,
  lifecycleStartMock: vi.fn(),
}));

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
  TauriBackendRuntime: class {},
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
    mocks.lifecycleStartMock.mockResolvedValue({
      state: "ready",
      detail: "Backend is ready.",
    });
  });

  it("renders first-screen workflow controls with single and batch tabs", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Douyin Downloader" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Single" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Batch" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Backend readiness" })).toBeInTheDocument();
    expect(screen.getByLabelText("Download location")).toBeInTheDocument();
    expect(screen.getByLabelText("Douyin URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start download" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Active job status" })).toBeInTheDocument();
  });

  it("switches to batch placeholder while preserving equal-weight mode controls", () => {
    render(<App />);
    const singleTab = screen.getByRole("tab", { name: "Single" });
    const batchTab = screen.getByRole("tab", { name: "Batch" });

    expect(singleTab).toHaveAttribute("aria-selected", "true");
    expect(batchTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(batchTab);

    expect(singleTab).toHaveAttribute("aria-selected", "false");
    expect(batchTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Batch controls are scaffolded and will be enabled in Phase 2.")).toBeInTheDocument();
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

    expect(screen.getByText("Only Douyin and iesdouyin links are supported in this phase.")).toBeInTheDocument();
    expect(mocks.createDownloadJobMock).not.toHaveBeenCalled();
  });

  it("rejects lookalike douyin hostnames before submit", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Douyin URL"), {
      target: { value: "https://douyin.com.evil.test/video/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start download" }));

    expect(screen.getByText("Only Douyin and iesdouyin links are supported in this phase.")).toBeInTheDocument();
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
    expect(screen.getByText("Start is disabled while backend readiness is pending.")).toBeInTheDocument();
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
      screen.getByText("Start is disabled while backend restarts with the updated output folder."),
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

    await waitFor(() => {
      expect(screen.getAllByText("Success").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Download finished successfully.")).toBeInTheDocument();
    }, { timeout: 2500 });
    expect(mocks.getJobMock).toHaveBeenCalledTimes(2);
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
  });
});

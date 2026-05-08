import { useEffect, useMemo, useState } from "react";
import { BackendStatusCard } from "../components/BackendStatusCard";
import { BatchDownloadPanel } from "../components/BatchDownloadPanel";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { JobStatusPanel } from "../components/JobStatusPanel";
import { OutputFolderControl } from "../components/OutputFolderControl";
import { SingleDownloadPanel } from "../components/SingleDownloadPanel";
import type { JobState } from "../services/backendClient";
import { createBackendClient } from "../services/backendClient";
import { BackendLifecycle, probeBackendHealth, wait } from "../services/backendLifecycle";
import { readImportedBatchText } from "../services/batchImportAdapter";
import { isBatchRowRetryEligible, parseBatchQueueInput, type BatchQueueRow, type BatchQueueTotals } from "../services/batchQueue";
import { createBatchQueueRunner, type BatchQueueRunnerSnapshot } from "../services/batchQueueRunner";
import { mapFailedJobError, mapPollingRequestError } from "../services/errorMapper";
import { createJobPoller } from "../services/jobPolling";
import { isTauriRuntimeAvailable, openOutputFolder, TauriBackendRuntime } from "../services/tauriBackendRuntime";

type Mode = "single" | "batch";
const EMPTY_BATCH_TOTALS: BatchQueueTotals = {
  total: 0,
  waiting: 0,
  running: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  retryEligible: 0,
  readyToSubmit: 0,
};

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [outputPath, setOutputPath] = useState("C:\\DouyinDownloads");
  const [configVersion, setConfigVersion] = useState(1);
  const [backendReadyConfigVersion, setBackendReadyConfigVersion] = useState(1);
  const [backendStatus, setBackendStatus] = useState<"starting" | "ready" | "error" | "stopped">("starting");
  const [backendDetail, setBackendDetail] = useState(
    "Waiting for backend readiness check.",
  );
  const [backendDiagnostics, setBackendDiagnostics] = useState<string[]>([]);
  const [submitMessage, setSubmitMessage] = useState<string>("");
  const [submitMessageTone, setSubmitMessageTone] = useState<"error" | "hint">("hint");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobState, setActiveJobState] = useState<JobState | null>(null);
  const [jobPanelMessage, setJobPanelMessage] = useState<string>("");
  const [jobPanelTone, setJobPanelTone] = useState<"error" | "hint">("hint");
  const [jobDiagnostics, setJobDiagnostics] = useState<string[]>([]);
  const [openingOutputFolder, setOpeningOutputFolder] = useState(false);
  const [batchInputText, setBatchInputText] = useState("");
  const [batchRows, setBatchRows] = useState<BatchQueueRow[]>([]);
  const [batchTotals, setBatchTotals] = useState<BatchQueueTotals>(EMPTY_BATCH_TOTALS);
  const [batchSchedulingEnabled, setBatchSchedulingEnabled] = useState(true);
  const [batchInFlightSubmissions, setBatchInFlightSubmissions] = useState(0);
  const [batchStarted, setBatchStarted] = useState(false);
  const [batchMessage, setBatchMessage] = useState("Paste multiline URLs or import a text file, then build the queue.");
  const [batchMessageTone, setBatchMessageTone] = useState<"error" | "hint">("hint");
  const backendClient = useMemo(() => createBackendClient({ baseUrl: "http://127.0.0.1:8787" }), []);
  const batchQueueRunner = useMemo(() => {
    return createBatchQueueRunner({
      backendClient,
      onSnapshot: (snapshot: BatchQueueRunnerSnapshot) => {
        setBatchRows(snapshot.rows);
        setBatchTotals(snapshot.totals);
        setBatchSchedulingEnabled(snapshot.schedulingEnabled);
        setBatchInFlightSubmissions(snapshot.inFlightSubmissions);
      },
    });
  }, [backendClient]);

  const modeDescription = useMemo(() => {
    if (mode === "single") {
      return "Single link download mode is active.";
    }
    return "Batch queue mode validates URLs and prepares rows before execution.";
  }, [mode]);

  useEffect(() => {
    if (!isTauriRuntimeAvailable()) {
      setBackendStatus("ready");
      setBackendDetail("Frontend preview mode. Managed lifecycle runs in Tauri desktop runtime.");
      setBackendReadyConfigVersion(configVersion);
      return undefined;
    }

    const lifecycle = new BackendLifecycle(new TauriBackendRuntime(), {
      healthProbe: probeBackendHealth,
      sleep: wait,
      now: () => Date.now(),
    });

    let mounted = true;
    setBackendStatus("starting");
    setBackendDetail("Starting backend and polling /api/v1/health...");

    void lifecycle
      .start({
        mode: "dev-python",
        host: "127.0.0.1",
        port: 8787,
        backendRoot: "F:\\Work\\DouyinDownload\\douyin-downloader",
        configPath: "F:\\Work\\DouyinDownload\\douyin-downloader-app\\.runtime\\managed-config.yml",
        outputPath,
        healthTimeoutMs: 12_000,
        healthPollMs: 400,
      })
      .then((ready) => {
        if (!mounted) {
          return;
        }
        setBackendStatus(ready.state);
        setBackendDetail(ready.detail);
        setBackendDiagnostics(lifecycle.getDiagnostics().map((entry) => entry.message));
        if (ready.state === "ready") {
          setBackendReadyConfigVersion(configVersion);
        }
      });

    return () => {
      mounted = false;
      void lifecycle.stop();
    };
  }, [outputPath, configVersion]);

  useEffect(() => {
    if (!activeJobId) {
      setActiveJobState(null);
      return undefined;
    }

    const poller = createJobPoller({
      jobId: activeJobId,
      backendClient,
      pollIntervalMs: 1000,
      onJob: (job) => {
        setActiveJobState(job);
        if (job.status === "success") {
          setJobPanelMessage("Download finished successfully.");
          setJobPanelTone("hint");
          return;
        }
        if (job.status === "failed") {
          const mapped = mapFailedJobError(job.error);
          if (!mapped) {
            return;
          }
          setJobPanelMessage(mapped.message);
          setJobPanelTone("error");
          setJobDiagnostics((existing) => existing.concat(mapped.diagnostics));
          return;
        }
        setJobPanelMessage("");
      },
      onError: (error) => {
        const mapped = mapPollingRequestError(error);
        setJobPanelMessage(mapped.message);
        setJobPanelTone("error");
        setJobDiagnostics((existing) => existing.concat(mapped.diagnostics));
      },
    });

    poller.start();
    return () => {
      poller.stop();
    };
  }, [activeJobId, backendClient]);

  useEffect(() => {
    return () => {
      batchQueueRunner.stop();
    };
  }, [batchQueueRunner]);

  const backendReadyForSubmit = backendStatus === "ready";
  const configReadyForSubmit = configVersion === backendReadyConfigVersion;
  const submitDisabled = !backendReadyForSubmit || !configReadyForSubmit || isSubmitting;

  const submitStatusMessage = useMemo(() => {
    if (isSubmitting) {
      return "Submitting download request...";
    }
    if (!configReadyForSubmit) {
      return "Start is disabled while backend restarts with the updated output folder.";
    }
    if (!backendReadyForSubmit) {
      return "Start is disabled while backend readiness is pending.";
    }
    return "";
  }, [backendReadyForSubmit, configReadyForSubmit, isSubmitting]);
  const batchHasRunningRows = batchRows.some((row) => row.status === "running");
  const batchHasWaitingRows = batchRows.some((row) => row.status === "waiting");
  const batchHasTerminalRows = batchRows.some((row) => row.status === "success" || row.status === "failed");
  const batchHasRetryEligibleRows = batchRows.some((row) => isBatchRowRetryEligible(row));
  const batchHasInFlightRows = batchHasRunningRows || batchInFlightSubmissions > 0;
  const activeBatchRow = batchRows.find((row) => row.status === "running");
  const batchQueueStatusLabel = useMemo(() => {
    if (!batchStarted) {
      return "Idle";
    }
    if (!batchSchedulingEnabled && batchHasWaitingRows) {
      return "Paused";
    }
    if (batchHasRunningRows || batchHasWaitingRows) {
      return "Running";
    }
    if (batchHasTerminalRows || batchTotals.skipped > 0) {
      return "Completed";
    }
    return "Idle";
  }, [batchHasRunningRows, batchHasTerminalRows, batchHasWaitingRows, batchSchedulingEnabled, batchStarted, batchTotals.skipped]);

  const hasTerminalJobState = activeJobState?.status === "success" || activeJobState?.status === "failed";
  const trimmedOutputPath = outputPath.trim();
  const hasConfiguredOutputPath = trimmedOutputPath.length > 0;

  const handleOpenOutputFolder = async (): Promise<void> => {
    if (!hasConfiguredOutputPath) {
      setJobPanelMessage("Choose an output folder first before opening it.");
      setJobPanelTone("hint");
      return;
    }

    setOpeningOutputFolder(true);
    try {
      await openOutputFolder(trimmedOutputPath);
      setJobPanelMessage("Opened the selected output folder.");
      setJobPanelTone("hint");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setJobDiagnostics((existing) => existing.concat(detail));
      if (detail.toLowerCase().includes("does not exist")) {
        setJobPanelMessage("The selected output folder is missing. Recreate it or choose a different folder.");
      } else {
        setJobPanelMessage("Could not open the selected output folder. Check diagnostics for details.");
      }
      setJobPanelTone("error");
    } finally {
      setOpeningOutputFolder(false);
    }
  };

  const handleSingleSubmit = async (): Promise<void> => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setSubmitMessage("Enter a Douyin URL before starting download.");
      setSubmitMessageTone("error");
      return;
    }

    if (!isAllowedDouyinUrl(trimmedUrl)) {
      setSubmitMessage("Only Douyin and iesdouyin links are supported in this phase.");
      setSubmitMessageTone("error");
      return;
    }

    if (submitDisabled) {
      setSubmitMessage(submitStatusMessage);
      setSubmitMessageTone("error");
      return;
    }

    setSubmitMessage("");
    setSubmitMessageTone("hint");
    setIsSubmitting(true);
    try {
      const response = await backendClient.createDownloadJob({ url: trimmedUrl });
      setActiveJobId(response.jobId);
      setActiveJobState(null);
      setJobPanelMessage("");
      setJobDiagnostics([]);
      setSubmitMessage(`Download queued as ${response.jobId}.`);
      setSubmitMessageTone("hint");
    } catch {
      setSubmitMessage("Could not submit download. Check backend status and try again.");
      setSubmitMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOutputPathChange = (nextPath: string): void => {
    setOutputPath(nextPath);
    setConfigVersion((version) => version + 1);
  };

  const handleBuildBatchQueue = (text: string): void => {
    batchQueueRunner.stop();
    setBatchStarted(false);
    setBatchSchedulingEnabled(true);
    setBatchInFlightSubmissions(0);
    const parseResult = parseBatchQueueInput(text);
    setBatchRows(parseResult.rows);
    setBatchTotals(parseResult.totals);
    if (parseResult.totals.total === 0) {
      setBatchMessage("Paste multiline URLs or import a text file, then build the queue.");
      setBatchMessageTone("hint");
      return;
    }
    setBatchMessage(
      `Queue built: ${parseResult.totals.readyToSubmit} ready, ${parseResult.totals.skipped} skipped.`,
    );
    setBatchMessageTone("hint");
  };

  const handleStartBatchQueue = (): void => {
    if (submitDisabled) {
      setBatchMessage(submitStatusMessage);
      setBatchMessageTone("error");
      return;
    }
    if (batchTotals.readyToSubmit === 0) {
      setBatchMessage("No ready URLs to start. Build a queue with valid Douyin links first.");
      setBatchMessageTone("error");
      return;
    }
    batchQueueRunner.start(batchRows);
    setBatchStarted(true);
    setBatchMessage("Batch queue started.");
    setBatchMessageTone("hint");
  };

  const handlePauseBatchQueue = (): void => {
    batchQueueRunner.pause();
    setBatchMessage("Queue paused. Active jobs continue polling to terminal state.");
    setBatchMessageTone("hint");
  };

  const handleResumeBatchQueue = (): void => {
    batchQueueRunner.resume();
    setBatchMessage("Queue resumed for waiting rows.");
    setBatchMessageTone("hint");
  };

  const handleRetryBatchQueue = (): void => {
    const retriedCount = batchQueueRunner.retryEligibleRows();
    if (retriedCount === 0) {
      setBatchMessage("No retry-eligible terminal rows are available.");
      setBatchMessageTone("error");
      return;
    }
    setBatchStarted(true);
    if (batchSchedulingEnabled) {
      setBatchMessage(`Retrying ${retriedCount} row${retriedCount === 1 ? "" : "s"}.`);
    } else {
      setBatchMessage(`Prepared retry for ${retriedCount} row${retriedCount === 1 ? "" : "s"}. Resume queue to continue.`);
    }
    setBatchMessageTone("hint");
  };

  const handleImportBatchText = async (): Promise<void> => {
    try {
      const importedText = await readImportedBatchText();
      setBatchInputText(importedText);
      handleBuildBatchQueue(importedText);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setBatchMessage(`Could not import URLs: ${detail}`);
      setBatchMessageTone("error");
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Douyin Downloader</h1>
        <p className="subtitle">Windows utility shell for managed desktop downloads</p>
      </header>

      <section className="layout-grid">
        <BackendStatusCard status={backendStatus} detail={backendDetail} />
        <OutputFolderControl outputPath={outputPath} onOutputPathChange={handleOutputPathChange} />

        <section className="card mode-card" aria-label="Download modes">
          <div className="mode-toggle" role="tablist" aria-label="Download mode tabs">
            <button
              role="tab"
              aria-selected={mode === "single"}
              className={mode === "single" ? "tab active" : "tab"}
              onClick={() => setMode("single")}
              type="button"
            >
              Single
            </button>
            <button
              role="tab"
              aria-selected={mode === "batch"}
              className={mode === "batch" ? "tab active" : "tab"}
              onClick={() => setMode("batch")}
              type="button"
            >
              Batch
            </button>
          </div>
          <p className="mode-description">{modeDescription}</p>
          {mode === "single" ? (
            <SingleDownloadPanel
              url={url}
              onUrlChange={setUrl}
              onSubmit={handleSingleSubmit}
              submitDisabled={submitDisabled}
              submitLabel={isSubmitting ? "Submitting..." : "Start download"}
              message={submitMessage || submitStatusMessage}
              messageTone={submitMessage ? submitMessageTone : "hint"}
            />
          ) : (
              <BatchDownloadPanel
                inputText={batchInputText}
                onInputTextChange={setBatchInputText}
                onBuildQueue={() => handleBuildBatchQueue(batchInputText)}
                onStartQueue={handleStartBatchQueue}
                onPauseQueue={handlePauseBatchQueue}
                onResumeQueue={handleResumeBatchQueue}
                onRetryQueue={handleRetryBatchQueue}
                onImportText={() => {
                  void handleImportBatchText();
                }}
                totals={batchTotals}
                rows={batchRows}
                queueStatusLabel={batchQueueStatusLabel}
                activeRowUrl={activeBatchRow?.normalizedUrl ?? activeBatchRow?.sourceText ?? null}
                activeJobId={activeBatchRow?.currentJobId ?? null}
                message={batchMessage}
                messageTone={batchMessageTone}
                startDisabled={submitDisabled || batchTotals.readyToSubmit === 0 || batchHasRunningRows}
                pauseDisabled={!batchStarted || !batchSchedulingEnabled || !batchHasWaitingRows}
                resumeDisabled={!batchStarted || batchSchedulingEnabled || !batchHasWaitingRows}
                retryDisabled={!batchStarted || !batchHasRetryEligibleRows || batchHasInFlightRows}
              />
            )}
          </section>

        <JobStatusPanel
          activeJobId={activeJobId}
          jobState={activeJobState}
          message={jobPanelMessage}
          messageTone={jobPanelTone}
          showResultActions={hasTerminalJobState}
          openOutputDisabled={!hasConfiguredOutputPath || openingOutputFolder}
          openOutputDisabledReason={hasConfiguredOutputPath ? "" : "Choose an output folder first before opening it."}
          openOutputInProgress={openingOutputFolder}
          onOpenOutputFolder={() => {
            void handleOpenOutputFolder();
          }}
        />
        <DiagnosticsPanel backendDiagnostics={backendDiagnostics} jobDiagnostics={jobDiagnostics} />
      </section>
      <div data-testid="backend-diagnostics-cache" hidden>
        {backendDiagnostics.join(" | ")}
      </div>
      <div data-testid="job-diagnostics-cache" hidden>
        {jobDiagnostics.join(" | ")}
      </div>
    </main>
  );
}

function isAllowedDouyinUrl(candidate: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (
    host === "douyin.com" ||
    host.endsWith(".douyin.com") ||
    host === "iesdouyin.com" ||
    host.endsWith(".iesdouyin.com")
  );
}

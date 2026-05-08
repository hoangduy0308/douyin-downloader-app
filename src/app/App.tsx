import { useEffect, useMemo, useRef, useState } from "react";
import { BackendStatusCard } from "../components/BackendStatusCard";
import { BatchDownloadPanel } from "../components/BatchDownloadPanel";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { JobStatusPanel } from "../components/JobStatusPanel";
import { OutputFolderControl } from "../components/OutputFolderControl";
import { SingleDownloadPanel } from "../components/SingleDownloadPanel";
import { AdvancedOptionsPanel } from "../components/AdvancedOptionsPanel";
import type { JobState } from "../services/backendClient";
import { createBackendClient } from "../services/backendClient";
import { BackendLifecycle, probeBackendHealth, wait } from "../services/backendLifecycle";
import { readImportedBatchText } from "../services/batchImportAdapter";
import {
  isBatchRowRetryEligible,
  parseBatchQueueInput,
  summarizeBatchQueue,
  type BatchQueueRow,
  type BatchQueueTotals,
} from "../services/batchQueue";
import { createBatchQueueRunner, type BatchQueueRunnerSnapshot } from "../services/batchQueueRunner";
import {
  CookieRecoveryService,
  TauriCookieRecoveryGateway,
  type CookieRecoveryResult,
} from "../services/cookieRecovery";
import { mapFailedJobError, mapPollingRequestError } from "../services/errorMapper";
import { createJobPoller } from "../services/jobPolling";
import {
  createDefaultRuntimeAdvancedOptions,
  RuntimeSettingsStore,
  type RuntimeAdvancedOptions,
  type RuntimeConfigWriter,
} from "../services/settingsStore";
import {
  ensureRuntimeDirectory,
  isTauriRuntimeAvailable,
  openOutputFolder,
  TauriBackendRuntime,
  writeManagedConfigAtomic,
} from "../services/tauriBackendRuntime";

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
const OUTPUT_PATH_STORAGE_KEY = "douyin-downloader-app.output-path";
const BACKEND_ROOT = "F:\\Work\\DouyinDownload\\douyin-downloader";
const MANAGED_CONFIG_PATH = "F:\\Work\\DouyinDownload\\douyin-downloader-app\\.runtime\\managed-config.yml";
const DEFAULT_OUTPUT_PATH = "C:\\DouyinDownloads";
const SINGLE_RETRY_GUIDANCE = "Retry this job after cookie recovery.";
const BATCH_RETRY_GUIDANCE = "Use Retry failed or row Retry after cookie recovery.";
const COOKIE_FALLBACK_GUIDANCE = "Manual/import cookie fallback remains available.";

function readPersistedOutputPathFromStorage(): string {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_OUTPUT_PATH;
  }
  const persisted = window.localStorage.getItem(OUTPUT_PATH_STORAGE_KEY);
  if (!persisted) {
    return DEFAULT_OUTPUT_PATH;
  }
  return persisted;
}

function createRuntimeSettingsWriter(): RuntimeConfigWriter {
  return {
    async resolveManagedConfigPath(): Promise<string> {
      return MANAGED_CONFIG_PATH;
    },
    async resolveDefaultOutputPath(): Promise<string> {
      return readPersistedOutputPathFromStorage();
    },
    async ensureDirectory(path: string): Promise<void> {
      await ensureRuntimeDirectory(path);
    },
    async writeConfigAtomic(path: string, contents: string): Promise<void> {
      await writeManagedConfigAtomic(path, contents);
    },
    async persistOutputPath(path: string): Promise<void> {
      if (typeof window === "undefined" || !window.localStorage) {
        return;
      }
      window.localStorage.setItem(OUTPUT_PATH_STORAGE_KEY, path);
    },
  };
}

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [outputPath, setOutputPath] = useState(readPersistedOutputPathFromStorage());
  const [advancedOptionsExpanded, setAdvancedOptionsExpanded] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState<RuntimeAdvancedOptions>(
    createDefaultRuntimeAdvancedOptions(),
  );
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
  const [singleCookieRecoveryInProgress, setSingleCookieRecoveryInProgress] = useState(false);
  const [batchCookieRecoveryInProgress, setBatchCookieRecoveryInProgress] = useState(false);
  const [openingOutputFolder, setOpeningOutputFolder] = useState(false);
  const [batchInputText, setBatchInputText] = useState("");
  const [batchRows, setBatchRows] = useState<BatchQueueRow[]>([]);
  const [batchTotals, setBatchTotals] = useState<BatchQueueTotals>(EMPTY_BATCH_TOTALS);
  const [batchSchedulingEnabled, setBatchSchedulingEnabled] = useState(true);
  const [batchInFlightSubmissions, setBatchInFlightSubmissions] = useState(0);
  const [batchStarted, setBatchStarted] = useState(false);
  const [batchMessage, setBatchMessage] = useState("Paste multiline URLs or import a text file, then build the queue.");
  const [batchMessageTone, setBatchMessageTone] = useState<"error" | "hint">("hint");
  const outputPathManuallyEdited = useRef(false);
  const settingsStore = useMemo(() => {
    return new RuntimeSettingsStore(createRuntimeSettingsWriter());
  }, []);
  const backendClient = useMemo(() => createBackendClient({ baseUrl: "http://127.0.0.1:8787" }), []);
  const cookieRecoveryService = useMemo(() => {
    return new CookieRecoveryService(new TauriCookieRecoveryGateway());
  }, []);
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
    let mounted = true;
    void settingsStore.initialize().then((snapshot) => {
      if (!mounted) {
        return;
      }
      if (!outputPathManuallyEdited.current) {
        setOutputPath(snapshot.outputPath);
      }
      setAdvancedOptions(snapshot.advancedOptions);
      setConfigVersion(snapshot.configVersion);
    }).catch((error) => {
      if (!mounted) {
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      setBackendStatus("error");
      setBackendDetail(`Settings initialization failed: ${detail}`);
    });
    return () => {
      mounted = false;
    };
  }, [settingsStore]);

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
          backendRoot: BACKEND_ROOT,
          configPath: MANAGED_CONFIG_PATH,
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
    }, [configVersion, outputPath, settingsStore]);

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
        return "Start is disabled while backend restarts with updated runtime settings.";
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
  const batchFinalTotals = useMemo(() => summarizeBatchQueue(batchRows), [batchRows]);
  const isBatchQueueComplete =
    batchStarted &&
    batchFinalTotals.total > 0 &&
    batchFinalTotals.waiting === 0 &&
    batchFinalTotals.running === 0 &&
    batchInFlightSubmissions === 0;
  const batchCompletionSummary = isBatchQueueComplete
    ? `Batch finished: ${batchFinalTotals.success} succeeded, ${batchFinalTotals.failed} failed, ${batchFinalTotals.skipped} skipped.`
    : null;
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
  const singleFailedJobError = useMemo(() => {
    if (activeJobState?.status !== "failed") {
      return null;
    }
    return mapFailedJobError(activeJobState.error);
  }, [activeJobState]);
  const showSingleCookieRecoveryActions = singleFailedJobError?.kind === "cookie-auth";
  const showBatchCookieRecoveryActions = useMemo(() => {
    return batchRows.some((row) => {
      if (row.status !== "failed") {
        return false;
      }
      return mapFailedJobError(row.lastError)?.kind === "cookie-auth";
    });
  }, [batchRows]);
  const batchFailureDiagnostics = useMemo(() => {
    return batchRows
      .filter((row) => row.lastError)
      .map((row) => `${row.id}: ${row.lastError}`);
  }, [batchRows]);

  const buildCookieRecoveryRequest = () => {
    return {
      backendRoot: BACKEND_ROOT,
      managedConfigPath: MANAGED_CONFIG_PATH,
      outputPath: hasConfiguredOutputPath ? trimmedOutputPath : DEFAULT_OUTPUT_PATH,
      pythonExecutable: "python",
      browser: "chromium" as const,
    };
  };

  const applyRecoveryResultToLogs = (result: CookieRecoveryResult): void => {
    if (result.diagnostics.length === 0) {
      return;
    }
    setJobDiagnostics((existing) => existing.concat(result.diagnostics));
  };

  const openConfiguredOutputFolder = async (): Promise<{
    message: string;
    tone: "error" | "hint";
    diagnostic: string | null;
  }> => {
    if (!hasConfiguredOutputPath) {
      return {
        message: "Choose an output folder first before opening it.",
        tone: "hint",
        diagnostic: null,
      };
    }

    try {
      await openOutputFolder(trimmedOutputPath);
      return {
        message: "Opened the selected output folder.",
        tone: "hint",
        diagnostic: null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.toLowerCase().includes("does not exist")) {
        return {
          message: "The selected output folder is missing. Recreate it or choose a different folder.",
          tone: "error",
          diagnostic: detail,
        };
      }
      return {
        message: "Could not open the selected output folder. Check diagnostics for details.",
        tone: "error",
        diagnostic: detail,
      };
    }
  };

  const handleOpenOutputFolderFromJobStatus = async (): Promise<void> => {
    setOpeningOutputFolder(true);
    try {
      const result = await openConfiguredOutputFolder();
      setJobPanelMessage(result.message);
      setJobPanelTone(result.tone);
      const diagnostic = result.diagnostic;
      if (diagnostic !== null) {
        setJobDiagnostics((existing) => existing.concat(diagnostic));
      }
    } finally {
      setOpeningOutputFolder(false);
    }
  };

  const handleOpenOutputFolderFromBatch = async (): Promise<void> => {
    setOpeningOutputFolder(true);
    try {
      const result = await openConfiguredOutputFolder();
      setBatchMessage(result.message);
      setBatchMessageTone(result.tone);
      const diagnostic = result.diagnostic;
      if (diagnostic !== null) {
        setJobDiagnostics((existing) => existing.concat(diagnostic));
      }
    } finally {
      setOpeningOutputFolder(false);
    }
  };

  const toRecoveryTone = (result: CookieRecoveryResult): "error" | "hint" => {
    if (result.status === "success" || result.status === "cancelled") {
      return "hint";
    }
    return "error";
  };

  const handleRecoverCookiesForSingle = async (): Promise<void> => {
    if (singleCookieRecoveryInProgress) {
      return;
    }
    setSingleCookieRecoveryInProgress(true);
    try {
      const result = await cookieRecoveryService.captureAndCommit(buildCookieRecoveryRequest());
      setJobPanelMessage(result.primaryMessage);
      setJobPanelTone(toRecoveryTone(result));
      applyRecoveryResultToLogs(result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setJobPanelMessage("Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.");
      setJobPanelTone("error");
      setJobDiagnostics((existing) => existing.concat(detail));
    } finally {
      setSingleCookieRecoveryInProgress(false);
    }
  };

  const handleRecoverCookiesForBatch = async (): Promise<void> => {
    if (batchCookieRecoveryInProgress) {
      return;
    }
    setBatchCookieRecoveryInProgress(true);
    try {
      const result = await cookieRecoveryService.captureAndCommit(buildCookieRecoveryRequest());
      setBatchMessage(result.primaryMessage);
      setBatchMessageTone(toRecoveryTone(result));
      applyRecoveryResultToLogs(result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setBatchMessage("Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.");
      setBatchMessageTone("error");
      setJobDiagnostics((existing) => existing.concat(detail));
    } finally {
      setBatchCookieRecoveryInProgress(false);
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
      outputPathManuallyEdited.current = true;
      if (nextPath.trim().length === 0) {
        setOutputPath("");
        return;
      }
      setOutputPath(nextPath);
      setConfigVersion((version) => version + 1);
      void settingsStore
        .updateOutputPath(nextPath)
        .then((snapshot) => {
          setOutputPath(snapshot.outputPath);
          setConfigVersion(snapshot.configVersion);
          setBackendReadyConfigVersion(snapshot.backendReadyConfigVersion);
        })
        .catch(() => {
          setSubmitMessage("Output path must be a Windows absolute path.");
          setSubmitMessageTone("error");
        });
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

  const handleRetryBatchRow = (rowId: string): void => {
    const didRetry = batchQueueRunner.retryRow(rowId);
    if (!didRetry) {
      setBatchMessage("This row is not retry-eligible right now.");
      setBatchMessageTone("error");
      return;
    }

    setBatchStarted(true);
    if (batchSchedulingEnabled) {
      setBatchMessage(`Retrying ${rowId}.`);
    } else {
      setBatchMessage(`Prepared retry for ${rowId}. Resume queue to continue.`);
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

  const handleAdvancedOptionsChange = (patch: Partial<RuntimeAdvancedOptions>): void => {
    setConfigVersion((version) => version + 1);
    void settingsStore
      .updateAdvancedOptions(patch)
      .then((snapshot) => {
        setAdvancedOptions(snapshot.advancedOptions);
        setConfigVersion(snapshot.configVersion);
        setBackendReadyConfigVersion(snapshot.backendReadyConfigVersion);
      })
      .catch(() => {
        setSubmitMessage("Could not apply advanced controls. Check values and try again.");
        setSubmitMessageTone("error");
      });
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
                  onRetryRow={handleRetryBatchRow}
                  onImportText={() => {
                    void handleImportBatchText();
                    }}
                  totals={batchTotals}
                  completionSummary={batchCompletionSummary}
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
                  showResultActions={isBatchQueueComplete}
                  openOutputDisabled={!hasConfiguredOutputPath || openingOutputFolder}
                  openOutputDisabledReason={hasConfiguredOutputPath ? "" : "Choose an output folder first before opening it."}
                  openOutputInProgress={openingOutputFolder}
                  showCookieRecoveryActions={showBatchCookieRecoveryActions}
                  cookieRecoveryInProgress={batchCookieRecoveryInProgress}
                  retryGuidance={BATCH_RETRY_GUIDANCE}
                  fallbackGuidance={COOKIE_FALLBACK_GUIDANCE}
                  onRecoverCookies={() => {
                    void handleRecoverCookiesForBatch();
                  }}
                  onOpenOutputFolder={() => {
                    void handleOpenOutputFolderFromBatch();
                  }}
                />
              )}
            </section>

        <AdvancedOptionsPanel
          expanded={advancedOptionsExpanded}
          options={advancedOptions}
          onToggle={() => setAdvancedOptionsExpanded((expanded) => !expanded)}
          onChange={handleAdvancedOptionsChange}
        />

        <JobStatusPanel
          activeJobId={activeJobId}
          jobState={activeJobState}
          message={jobPanelMessage}
          messageTone={jobPanelTone}
          showResultActions={hasTerminalJobState}
          openOutputDisabled={!hasConfiguredOutputPath || openingOutputFolder}
          openOutputDisabledReason={hasConfiguredOutputPath ? "" : "Choose an output folder first before opening it."}
          openOutputInProgress={openingOutputFolder}
          showCookieRecoveryActions={showSingleCookieRecoveryActions}
          cookieRecoveryInProgress={singleCookieRecoveryInProgress}
          retryGuidance={SINGLE_RETRY_GUIDANCE}
          fallbackGuidance={COOKIE_FALLBACK_GUIDANCE}
          onRecoverCookies={() => {
            void handleRecoverCookiesForSingle();
          }}
          onOpenOutputFolder={() => {
            void handleOpenOutputFolderFromJobStatus();
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
        <div data-testid="batch-diagnostics-cache" hidden>
          {batchFailureDiagnostics.join(" | ")}
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

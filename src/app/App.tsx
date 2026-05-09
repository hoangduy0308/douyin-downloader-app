import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackendStatusCard } from "../components/BackendStatusCard";
import { BatchDownloadPanel } from "../components/BatchDownloadPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { JobStatusPanel } from "../components/JobStatusPanel";
import { LogsPanel } from "../components/LogsPanel";
import { OutputFolderControl } from "../components/OutputFolderControl";
import { SingleDownloadPanel } from "../components/SingleDownloadPanel";
import { AdvancedOptionsPanel } from "../components/AdvancedOptionsPanel";
import type { JobState } from "../services/backendClient";
import { createBackendClient } from "../services/backendClient";
import {
  BackendLifecycle,
  probeBackendHealth,
  wait,
  type BackendRuntimeMode,
} from "../services/backendLifecycle";
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
  AppHistoryStore,
  type HistoryDiagnosticEvent,
  type HistoryEntry,
  type HistoryFileStore,
  type HistoryEntryUpsertInput,
} from "../services/historyStore";
import {
  createDefaultRuntimeAdvancedOptions,
  RuntimeSettingsStore,
  type RuntimeAdvancedOptions,
  type RuntimeConfigWriter,
} from "../services/settingsStore";
import { AppLogStore, FRONTEND_LOG_CAP } from "../services/logStore";
import {
  ensureRuntimeDirectory,
  isTauriRuntimeAvailable,
  openOutputFolder,
  readRuntimeStateFile,
  resolveManagedConfigPath,
  TauriBackendRuntime,
  writeRuntimeStateFileAtomic,
  writeManagedConfigAtomic,
} from "../services/tauriBackendRuntime";

type Mode = "single" | "batch" | "logs";
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
const OUTPUT_PATH_RUNTIME_FILE_NAME = "output-path.txt";
const FALLBACK_MANAGED_CONFIG_PATH = "C:\\DouyinDownloaderApp\\runtime\\managed-config.yml";
const DEFAULT_OUTPUT_PATH = "C:\\DouyinDownloads";
const SINGLE_RETRY_GUIDANCE = "Retry this job after cookie recovery.";
const BATCH_RETRY_GUIDANCE = "Use Retry failed or row Retry after cookie recovery.";
const COOKIE_FALLBACK_GUIDANCE = "Manual/import cookie fallback remains available.";
const HISTORY_STORAGE_KEY = "douyin-downloader-app.history.v1";
const HISTORY_RUNTIME_FILE_NAME = "history.v1.json";

interface BackendLaunchConfig {
  mode: BackendRuntimeMode;
  backendRoot?: string;
  pythonExecutable?: string;
}

function readViteEnv(name: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  return typeof value === "string" ? value : "";
}

function readViteEnvFlag(name: string): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true";
  }
  return false;
}

function resolveBackendLaunchConfig(): BackendLaunchConfig {
  const requestedMode = readViteEnv("VITE_DOUYIN_BACKEND_MODE").trim().toLowerCase();
  const devBackendRoot = readViteEnv("VITE_DOUYIN_BACKEND_ROOT").trim();
  const configuredPythonExecutable = readViteEnv("VITE_DOUYIN_DEV_PYTHON").trim();
  const devPythonExecutable = configuredPythonExecutable.length > 0
    ? configuredPythonExecutable
    : "python";
  const isDev = readViteEnvFlag("DEV");

  if (requestedMode === "dev-python" || (isDev && devBackendRoot.length > 0)) {
    return {
      mode: "dev-python",
      backendRoot: devBackendRoot.length > 0 ? devBackendRoot : undefined,
      pythonExecutable: devPythonExecutable.length > 0 ? devPythonExecutable : undefined,
    };
  }

  return {
    mode: "managed-sidecar",
  };
}

const BACKEND_LAUNCH_CONFIG = resolveBackendLaunchConfig();

function readFromBrowserStorage(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage.getItem(key);
}

function writeToBrowserStorage(key: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(key, value);
}

function resolveRuntimeStatePathFromManagedConfigPath(
  managedConfigPath: string,
  fileName: string,
): string {
  const normalized = managedConfigPath.replace(/\//g, "\\");
  const separatorIndex = normalized.lastIndexOf("\\");
  if (separatorIndex <= 0) {
    return `${normalized}\\${fileName}`;
  }
  return `${normalized.slice(0, separatorIndex)}\\${fileName}`;
}

async function resolveRuntimeStatePath(fileName: string): Promise<string> {
  const managedConfigPath = await resolveManagedConfigPath(FALLBACK_MANAGED_CONFIG_PATH);
  return resolveRuntimeStatePathFromManagedConfigPath(managedConfigPath, fileName);
}

async function readPersistedOutputPath(): Promise<string> {
  if (isTauriRuntimeAvailable()) {
    const outputPathStateFile = await resolveRuntimeStatePath(OUTPUT_PATH_RUNTIME_FILE_NAME);
    const persisted = await readRuntimeStateFile(outputPathStateFile);
    if (persisted && persisted.trim().length > 0) {
      return persisted.trim();
    }
  }
  const browserPersisted = readFromBrowserStorage(OUTPUT_PATH_STORAGE_KEY);
  if (!browserPersisted || browserPersisted.trim().length === 0) {
    return DEFAULT_OUTPUT_PATH;
  }
  return browserPersisted;
}

function createRuntimeSettingsWriter(): RuntimeConfigWriter {
  return {
    async resolveManagedConfigPath(): Promise<string> {
      return resolveManagedConfigPath(FALLBACK_MANAGED_CONFIG_PATH);
    },
    async resolveDefaultOutputPath(): Promise<string> {
      return readPersistedOutputPath();
    },
    async ensureDirectory(path: string): Promise<void> {
      await ensureRuntimeDirectory(path);
    },
    async writeConfigAtomic(path: string, contents: string): Promise<void> {
      await writeManagedConfigAtomic(path, contents);
    },
    async persistOutputPath(path: string): Promise<void> {
      if (isTauriRuntimeAvailable()) {
        const outputPathStateFile = await resolveRuntimeStatePath(OUTPUT_PATH_RUNTIME_FILE_NAME);
        await writeRuntimeStateFileAtomic(outputPathStateFile, path);
        return;
      }
      writeToBrowserStorage(OUTPUT_PATH_STORAGE_KEY, path);
    },
  };
}

function createHistoryFileStore(): HistoryFileStore {
  return {
    async read(): Promise<string | null> {
      if (isTauriRuntimeAvailable()) {
        const historyStateFile = await resolveRuntimeStatePath(HISTORY_RUNTIME_FILE_NAME);
        return readRuntimeStateFile(historyStateFile);
      }
      return readFromBrowserStorage(HISTORY_STORAGE_KEY);
    },
    async write(nextContents: string): Promise<void> {
      if (isTauriRuntimeAvailable()) {
        const historyStateFile = await resolveRuntimeStatePath(HISTORY_RUNTIME_FILE_NAME);
        await writeRuntimeStateFileAtomic(historyStateFile, nextContents);
        return;
      }
      writeToBrowserStorage(HISTORY_STORAGE_KEY, nextContents);
    },
  };
}

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("single");
  const [url, setUrl] = useState("");
  const [outputPath, setOutputPath] = useState(DEFAULT_OUTPUT_PATH);
  const [advancedOptionsExpanded, setAdvancedOptionsExpanded] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState<RuntimeAdvancedOptions>(
    createDefaultRuntimeAdvancedOptions(),
  );
  const [settingsInitializationState, setSettingsInitializationState] = useState<
    "pending" | "ready" | "error"
  >("pending");
  const [configVersion, setConfigVersion] = useState(1);
  const [managedConfigPath, setManagedConfigPath] = useState(FALLBACK_MANAGED_CONFIG_PATH);
  const [backendReadyConfigVersion, setBackendReadyConfigVersion] = useState(1);
  const [backendStatus, setBackendStatus] = useState<"starting" | "ready" | "error" | "stopped">("starting");
  const [backendDetail, setBackendDetail] = useState(
    "Waiting for backend readiness check.",
  );
  const [logEvents, setLogEvents] = useState<ReturnType<AppLogStore["getEventsNewestFirst"]>>([]);
  const [submitMessage, setSubmitMessage] = useState<string>("");
  const [submitMessageTone, setSubmitMessageTone] = useState<"error" | "hint">("hint");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobState, setActiveJobState] = useState<JobState | null>(null);
  const [activeJobUrl, setActiveJobUrl] = useState<string | null>(null);
  const [jobPanelMessage, setJobPanelMessage] = useState<string>("");
  const [jobPanelTone, setJobPanelTone] = useState<"error" | "hint">("hint");
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
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
  const [batchRunId, setBatchRunId] = useState("batch-run-0");
  const logStoreRef = useRef(new AppLogStore(FRONTEND_LOG_CAP));
  const outputPathManuallyEdited = useRef(false);
  const batchRunCounter = useRef(0);
  const recordedBatchHistoryRef = useRef<Record<string, string>>({});
  const appendLog = useCallback(
    (
      level: "info" | "warn" | "error",
      source: string,
      message: string,
      context?: Record<string, string | number | boolean | null | undefined>,
    ): void => {
      const next = logStoreRef.current.append({
        level,
        source,
        message,
        context,
      });
      setLogEvents(next);
    },
    [],
  );
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
  const historyStore = useMemo(() => {
    return new AppHistoryStore({
      fileStore: createHistoryFileStore(),
      onDiagnostic: (event: HistoryDiagnosticEvent) => {
        appendLog("error", "history", `history ${event.action}: ${event.message}`, {
          action: event.action,
        });
      },
    });
  }, [appendLog]);

  const upsertHistoryEntry = useCallback(
    async (input: HistoryEntryUpsertInput): Promise<void> => {
      const entries = await historyStore.upsert(input);
      setHistoryEntries(entries);
    },
    [historyStore],
  );

  const modeDescription = useMemo(() => {
    if (mode === "single") {
      return "Single link download mode is active.";
    }
    if (mode === "batch") {
      return "Batch queue mode validates URLs and prepares rows before execution.";
    }
    return "Technical diagnostics with bounded retention and redaction.";
  }, [mode]);

  useEffect(() => {
    let mounted = true;
    setSettingsInitializationState("pending");
    void settingsStore.initialize().then((snapshot) => {
      if (!mounted) {
        return;
      }
        if (!outputPathManuallyEdited.current) {
          setOutputPath(snapshot.outputPath);
        }
        setManagedConfigPath(snapshot.configPath);
        setAdvancedOptions(snapshot.advancedOptions);
        setConfigVersion(snapshot.configVersion);
      setSettingsInitializationState("ready");
    }).catch((error) => {
      if (!mounted) {
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      setSettingsInitializationState("error");
      setBackendStatus("error");
      setBackendDetail(`Settings initialization failed: ${detail}`);
      appendLog("error", "settings", detail, { action: "initialize" });
    });
    return () => {
      mounted = false;
    };
  }, [appendLog, settingsStore]);

  useEffect(() => {
    if (!isTauriRuntimeAvailable()) {
      setBackendStatus("ready");
      setBackendDetail("Frontend preview mode. Managed lifecycle runs in Tauri desktop runtime.");
      setBackendReadyConfigVersion(configVersion);
      return undefined;
    }
    if (settingsInitializationState !== "ready") {
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
            mode: BACKEND_LAUNCH_CONFIG.mode,
            host: "127.0.0.1",
            port: 8787,
            backendRoot: BACKEND_LAUNCH_CONFIG.backendRoot,
            pythonExecutable: BACKEND_LAUNCH_CONFIG.pythonExecutable,
            configPath: managedConfigPath,
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
          const lifecycleDiagnostics = lifecycle.getDiagnostics();
          const next = logStoreRef.current.appendMany(
            lifecycleDiagnostics.map((entry) => ({
              at: entry.at,
              level: entry.level === "error" ? "error" : "info",
              source: `backend.${entry.source}`,
              message: entry.message,
            })),
          );
          setLogEvents(next);
          if (ready.state === "ready") {
            setBackendReadyConfigVersion(configVersion);
          }
        });

    return () => {
      mounted = false;
      void lifecycle.stop();
    };
      }, [configVersion, managedConfigPath, outputPath, settingsInitializationState, settingsStore]);

  useEffect(() => {
    let mounted = true;
    void historyStore
      .load()
      .then((entries) => {
        if (!mounted) {
          return;
        }
        setHistoryEntries(entries);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setHistoryEntries([]);
      });
    return () => {
      mounted = false;
    };
  }, [historyStore]);

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
            const targetUrl = activeJobUrl;
            if (targetUrl !== null) {
              const finishedAt = job.finishedAt ?? new Date().toISOString();
              const outputPathValue = outputPath.trim().length > 0 ? outputPath.trim() : null;
              void upsertHistoryEntry({
                logicalId: `single:${job.jobId}`,
                mode: "single",
                url: targetUrl,
                status: "success",
                outputPath: outputPathValue,
                resultLocation: outputPathValue,
                errorSummary: null,
                finishedAt,
                recordedAt: finishedAt,
              });
            }
            return;
          }
          if (job.status === "failed") {
          const mapped = mapFailedJobError(job.error);
          if (!mapped) {
            return;
          }
            setJobPanelMessage(mapped.message);
            setJobPanelTone("error");
            const diagnostics = Array.isArray(mapped.diagnostics) ? mapped.diagnostics : [mapped.diagnostics];
            for (const diagnostic of diagnostics) {
              appendLog("error", "job.failed", diagnostic, {
                jobId: job.jobId,
              });
            }
            const targetUrl = activeJobUrl;
            if (targetUrl !== null) {
              const finishedAt = job.finishedAt ?? new Date().toISOString();
              const outputPathValue = outputPath.trim().length > 0 ? outputPath.trim() : null;
              void upsertHistoryEntry({
                logicalId: `single:${job.jobId}`,
                mode: "single",
                url: targetUrl,
                status: "failed",
                outputPath: outputPathValue,
                resultLocation: outputPathValue,
                errorSummary: mapped.message,
                finishedAt,
                recordedAt: finishedAt,
              });
            }
            return;
          }
          setJobPanelMessage("");
      },
      onError: (error) => {
        const mapped = mapPollingRequestError(error);
        setJobPanelMessage(mapped.message);
        setJobPanelTone("error");
        const diagnostics = Array.isArray(mapped.diagnostics) ? mapped.diagnostics : [mapped.diagnostics];
        for (const diagnostic of diagnostics) {
          appendLog("error", "job.polling", diagnostic, {
            jobId: activeJobId,
          });
        }
      },
    });

    poller.start();
    return () => {
      poller.stop();
    };
    }, [activeJobId, activeJobUrl, appendLog, backendClient, outputPath, upsertHistoryEntry]);

  useEffect(() => {
    return () => {
      batchQueueRunner.stop();
    };
  }, [batchQueueRunner]);

  useEffect(() => {
    const outputPathValue = outputPath.trim().length > 0 ? outputPath.trim() : null;
    for (const row of batchRows) {
      if (row.status !== "success" && row.status !== "failed" && row.status !== "skipped") {
        continue;
      }
      const logicalId = `batch:${batchRunId}:${row.id}`;
      const fingerprint = `${row.status}|${row.lastError ?? ""}|${row.lastJobId ?? ""}|${row.attempt}`;
      if (recordedBatchHistoryRef.current[logicalId] === fingerprint) {
        continue;
      }
      recordedBatchHistoryRef.current[logicalId] = fingerprint;
      if (row.status === "failed" && row.lastError) {
        appendLog("error", "batch.row", row.lastError, {
          rowId: row.id,
          runId: batchRunId,
          jobId: row.lastJobId ?? "",
          attempt: row.attempt,
        });
      }
      if (row.status === "skipped" && row.skipReason) {
        appendLog("warn", "batch.validation", row.skipReason, {
          rowId: row.id,
          runId: batchRunId,
        });
      }

      const now = new Date().toISOString();
      const status = row.status === "success" ? "success" : row.status === "failed" ? "failed" : "skipped";
      const errorSummary =
        row.status === "failed"
          ? row.lastError ?? "Batch row failed."
          : row.status === "skipped"
            ? `validation:${row.skipReason ?? "skipped"}`
            : null;

      void upsertHistoryEntry({
        logicalId,
        mode: "batch-row",
        url: row.normalizedUrl ?? row.sourceText,
        status,
        outputPath: outputPathValue,
        resultLocation: outputPathValue,
        errorSummary,
        finishedAt: now,
        recordedAt: now,
      });
    }
  }, [appendLog, batchRows, batchRunId, outputPath, upsertHistoryEntry]);

  const requiresManagedSettingsGate = isTauriRuntimeAvailable();
  const backendReadyForSubmit = backendStatus === "ready";
  const configReadyForSubmit = configVersion === backendReadyConfigVersion;
    const submitDisabled =
      (requiresManagedSettingsGate && settingsInitializationState !== "ready") ||
      !backendReadyForSubmit ||
      !configReadyForSubmit ||
      isSubmitting;

  const submitStatusMessage = useMemo(() => {
      if (requiresManagedSettingsGate && settingsInitializationState === "pending") {
        return "Start is disabled while runtime settings are initializing.";
      }
      if (requiresManagedSettingsGate && settingsInitializationState === "error") {
        return "Start is disabled because runtime settings failed to initialize.";
      }
      if (settingsInitializationState === "pending") {
        return "";
      }
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
    }, [backendReadyForSubmit, configReadyForSubmit, isSubmitting, requiresManagedSettingsGate, settingsInitializationState]);
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
  const backendDiagnostics = useMemo(() => {
    return logEvents
      .filter((event) => event.source.startsWith("backend."))
      .map((event) => event.message);
  }, [logEvents]);
  const jobDiagnostics = useMemo(() => {
    return logEvents
      .filter((event) => event.source.startsWith("job.") || event.source.startsWith("cookie.") || event.source === "filesystem.output" || event.source === "history")
      .map((event) => event.message);
  }, [logEvents]);
  const batchFailureDiagnostics = useMemo(() => {
    return logEvents
      .filter((event) => event.source === "batch.row")
      .map((event) => event.message);
  }, [logEvents]);

  const buildCookieRecoveryRequest = () => {
    return {
      backendRoot: BACKEND_LAUNCH_CONFIG.backendRoot ?? "",
      managedConfigPath,
      outputPath: hasConfiguredOutputPath ? trimmedOutputPath : DEFAULT_OUTPUT_PATH,
      pythonExecutable: BACKEND_LAUNCH_CONFIG.pythonExecutable,
      browser: "chromium" as const,
    };
  };

  const applyRecoveryResultToLogs = (result: CookieRecoveryResult): void => {
    if (result.diagnostics.length === 0) {
      return;
    }
    for (const diagnostic of result.diagnostics) {
      appendLog("info", "cookie.recovery", diagnostic);
    }
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
        message: "Could not open the selected output folder. Check Logs for details.",
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
        appendLog("error", "filesystem.output", diagnostic, {
          action: "open-from-job-panel",
        });
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
        appendLog("error", "filesystem.output", diagnostic, {
          action: "open-from-batch-panel",
        });
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
      appendLog("error", "cookie.recovery", detail, {
        mode: "single",
      });
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
      appendLog("error", "cookie.recovery", detail, {
        mode: "batch",
      });
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
      setActiveJobUrl(trimmedUrl);
      setActiveJobState(null);
      setJobPanelMessage("");
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
          appendLog("error", "settings", "Output path must be a Windows absolute path.", {
            action: "update-output-path",
          });
        });
    };

  const handleBuildBatchQueue = (text: string): void => {
    batchRunCounter.current += 1;
    setBatchRunId(`batch-run-${batchRunCounter.current}`);
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
      appendLog("error", "batch.import", detail);
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
        appendLog("error", "settings", "Could not apply advanced controls.", {
          action: "update-advanced-options",
        });
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
            <button
              role="tab"
              aria-selected={mode === "logs"}
              className={mode === "logs" ? "tab active" : "tab"}
              onClick={() => setMode("logs")}
              type="button"
            >
              Logs
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
          ) : mode === "batch" ? (
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
              ) : (
                <LogsPanel events={logEvents} cap={FRONTEND_LOG_CAP} />
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
          <HistoryPanel entries={historyEntries} />
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

import { useEffect, useMemo, useState } from "react";
import { BackendStatusCard } from "../components/BackendStatusCard";
import { JobStatusPanel } from "../components/JobStatusPanel";
import { OutputFolderControl } from "../components/OutputFolderControl";
import { SingleDownloadPanel } from "../components/SingleDownloadPanel";
import type { JobState } from "../services/backendClient";
import { createBackendClient } from "../services/backendClient";
import { BackendLifecycle, probeBackendHealth, wait } from "../services/backendLifecycle";
import { mapFailedJobError, mapPollingRequestError } from "../services/errorMapper";
import { createJobPoller } from "../services/jobPolling";
import { isTauriRuntimeAvailable, TauriBackendRuntime } from "../services/tauriBackendRuntime";

type Mode = "single" | "batch";

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
  const backendClient = useMemo(() => createBackendClient({ baseUrl: "http://127.0.0.1:8787" }), []);

  const modeDescription = useMemo(() => {
    if (mode === "single") {
      return "Single link download mode is active.";
    }
    return "Batch queue mode is available in upcoming phase work.";
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
            <p className="batch-placeholder">Batch controls are scaffolded and will be enabled in Phase 2.</p>
          )}
        </section>

        <JobStatusPanel
          activeJobId={activeJobId}
          jobState={activeJobState}
          message={jobPanelMessage}
          messageTone={jobPanelTone}
        />
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

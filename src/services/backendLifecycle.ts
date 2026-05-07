export type BackendReadinessState = "starting" | "ready" | "error" | "stopped";

export type BackendRuntimeMode = "dev-python" | "attach";

export interface BackendDiagnostic {
  at: string;
  level: "info" | "error";
  source: "lifecycle" | "health" | "stdout" | "stderr";
  message: string;
}

export interface BackendReadiness {
  state: BackendReadinessState;
  detail: string;
}

export interface BackendStartConfig {
  mode?: BackendRuntimeMode;
  host?: string;
  port?: number;
  backendRoot?: string;
  pythonExecutable?: string;
  configPath: string;
  outputPath: string;
  healthTimeoutMs?: number;
  healthPollMs?: number;
}

export interface BackendRuntimeStartRequest {
  mode: BackendRuntimeMode;
  host: string;
  port: number;
  backendRoot?: string;
  pythonExecutable?: string;
  configPath: string;
  outputPath: string;
}

export interface BackendRuntime {
  start(request: BackendRuntimeStartRequest): Promise<void>;
  stop(): Promise<void>;
  getDiagnostics(): Promise<BackendDiagnostic[]>;
}

export interface HealthProbe {
  healthy: boolean;
  statusCode: number;
  statusText: string;
}

export interface BackendLifecycleDependencies {
  healthProbe: (host: string, port: number) => Promise<HealthProbe>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_MS = 400;

export class BackendLifecycle {
  private readiness: BackendReadiness = {
    state: "stopped",
    detail: "Backend is stopped.",
  };

  private diagnostics: BackendDiagnostic[] = [];
  private managedProcessOwned = false;
  private activeMode: BackendRuntimeMode = "dev-python";

  public constructor(
    private readonly runtime: BackendRuntime,
    private readonly deps: BackendLifecycleDependencies,
  ) {}

  public getReadiness(): BackendReadiness {
    return this.readiness;
  }

  public getDiagnostics(): BackendDiagnostic[] {
    return [...this.diagnostics];
  }

  public async start(config: BackendStartConfig): Promise<BackendReadiness> {
    const host = config.host ?? DEFAULT_HOST;
    const port = config.port ?? DEFAULT_PORT;
    const mode = config.mode ?? "dev-python";
    const timeoutMs = config.healthTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollMs = config.healthPollMs ?? DEFAULT_POLL_MS;

    this.activeMode = mode;
    this.managedProcessOwned = mode === "dev-python";
    this.diagnostics = [];
    this.readiness = {
      state: "starting",
      detail: `Starting backend in ${mode} mode...`,
    };
    this.pushDiagnostic("info", "lifecycle", this.readiness.detail);

    try {
      await this.runtime.start({
        mode,
        host,
        port,
        backendRoot: config.backendRoot,
        pythonExecutable: config.pythonExecutable,
        configPath: config.configPath,
        outputPath: config.outputPath,
      });
    } catch (error) {
      const message = this.errorMessage(error);
      this.pushDiagnostic("error", "lifecycle", `Backend start failed: ${message}`);
      this.readiness = {
        state: "error",
        detail: "Cannot start backend. Check diagnostics.",
      };
      await this.pullRuntimeDiagnostics();
      return this.readiness;
    }

    const deadline = this.deps.now() + timeoutMs;
    let probe: HealthProbe = {
      healthy: false,
      statusCode: 0,
      statusText: "No response yet",
    };

    while (this.deps.now() < deadline) {
      probe = await this.deps.healthProbe(host, port);
      if (probe.healthy) {
        this.readiness = {
          state: "ready",
          detail: `Backend ready at http://${host}:${port}.`,
        };
        this.pushDiagnostic("info", "health", `Health check passed (${probe.statusCode}).`);
        await this.pullRuntimeDiagnostics();
        return this.readiness;
      }

      this.pushDiagnostic(
        "info",
        "health",
        `Health not ready: ${probe.statusCode} ${probe.statusText}.`,
      );
      await this.deps.sleep(pollMs);
    }

    this.pushDiagnostic(
      "error",
      "health",
      `Health timeout at http://${host}:${port}/api/v1/health after ${timeoutMs}ms.`,
    );
    if (this.managedProcessOwned) {
      await this.runtime.stop();
      this.managedProcessOwned = false;
      this.pushDiagnostic("info", "lifecycle", "Managed backend process stopped after timeout.");
    }

    this.readiness = {
      state: "error",
      detail: "Backend did not become ready before timeout.",
    };
    await this.pullRuntimeDiagnostics();
    return this.readiness;
  }

  public async stop(): Promise<BackendReadiness> {
    if (this.managedProcessOwned && this.activeMode === "dev-python") {
      await this.runtime.stop();
      this.pushDiagnostic("info", "lifecycle", "Managed backend process stopped.");
    } else {
      this.pushDiagnostic(
        "info",
        "lifecycle",
        "Stop requested for attach mode; external backend left running.",
      );
    }

    this.managedProcessOwned = false;
    this.readiness = {
      state: "stopped",
      detail: "Backend is stopped.",
    };
    await this.pullRuntimeDiagnostics();
    return this.readiness;
  }

  private async pullRuntimeDiagnostics(): Promise<void> {
    const runtimeDiagnostics = await this.runtime.getDiagnostics();
    if (runtimeDiagnostics.length === 0) {
      return;
    }
    this.diagnostics = [...this.diagnostics, ...runtimeDiagnostics];
  }

  private pushDiagnostic(
    level: BackendDiagnostic["level"],
    source: BackendDiagnostic["source"],
    message: string,
  ): void {
    this.diagnostics.push({
      at: new Date().toISOString(),
      level,
      source,
      message,
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

export async function probeBackendHealth(host: string, port: number): Promise<HealthProbe> {
  const url = `http://${host}:${port}/api/v1/health`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const json = (await response.json().catch(() => null)) as { status?: string } | null;
    return {
      healthy: response.ok && json?.status === "ok",
      statusCode: response.status,
      statusText: response.statusText,
    };
  } catch {
    return {
      healthy: false,
      statusCode: 0,
      statusText: "Network error",
    };
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

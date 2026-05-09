import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BackendDiagnostic, BackendRuntime, BackendRuntimeStartRequest } from "./backendLifecycle";

interface BackendStartPayload {
  request: {
    mode: "managed-sidecar" | "dev-python" | "attach";
    host: string;
    port: number;
    backendRoot?: string;
    pythonExecutable?: string;
    configPath: string;
    outputPath: string;
  };
}

interface OpenOutputFolderPayload {
  request: {
    path: string;
  };
}

interface SettingsEnsureDirectoryPayload {
  request: Record<string, never>;
}

interface SettingsWriteConfigAtomicPayload {
  request: {
    contents: string;
  };
}

interface SettingsReadTextFilePayload {
  request: {
    fileName: string;
  };
}

interface SettingsWriteTextFileAtomicPayload {
  request: {
    fileName: string;
    contents: string;
  };
}

interface RuntimePathsResponse {
  managedConfigPath: string;
}

interface CookieCaptureAndCommitPayload {
  request: {
    browser?: "chromium" | "firefox" | "webkit";
  };
}

export interface CookieCaptureAndCommitResult {
  status: "success" | "cancelled" | "missing-runtime" | "failed";
  exitCode: number | null;
  diagnostics: string[];
  error?: string | null;
}

function hasTauriPlatformEnvHint(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const value = env?.TAURI_ENV_PLATFORM;
  return typeof value === "string" && value.trim().length > 0;
}

function hasTauriIpcHint(): boolean {
  const scope = globalThis as typeof globalThis & {
    __TAURI_IPC__?: unknown;
  };
  return typeof scope.__TAURI_IPC__ === "function";
}

function hasTauriInternalsHint(): boolean {
  const scope = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
  };
  return typeof scope.__TAURI_INTERNALS__ === "object" && scope.__TAURI_INTERNALS__ !== null;
}

export function isTauriRuntimeAvailable(): boolean {
  return isTauri() || hasTauriPlatformEnvHint() || hasTauriIpcHint() || hasTauriInternalsHint();
}

export class TauriBackendRuntime implements BackendRuntime {
  public async start(request: BackendRuntimeStartRequest): Promise<void> {
    await invoke("backend_start", {
      request: {
        mode: request.mode,
        host: request.host,
        port: request.port,
        backendRoot: request.backendRoot,
        pythonExecutable: request.pythonExecutable,
        configPath: request.configPath,
        outputPath: request.outputPath,
      },
    } satisfies BackendStartPayload);
  }

  public async stop(): Promise<void> {
    await invoke("backend_stop");
  }

  public async getDiagnostics(): Promise<BackendDiagnostic[]> {
    const diagnostics = await invoke<BackendDiagnostic[]>("backend_diagnostics");
    return diagnostics ?? [];
  }
}

export async function resolveManagedConfigPath(
  fallbackPath: string,
): Promise<string> {
  if (!isTauriRuntimeAvailable()) {
    return fallbackPath;
  }
  const response = await invoke<RuntimePathsResponse>("backend_runtime_paths");
  return response?.managedConfigPath ?? fallbackPath;
}

export async function openOutputFolder(path: string): Promise<void> {
  await invoke("open_output_folder", {
    request: {
      path,
    },
  } satisfies OpenOutputFolderPayload);
}

export async function ensureRuntimeDirectory(path: string): Promise<void> {
  void path;
  if (!isTauriRuntimeAvailable()) {
    return;
  }
  await invoke("settings_ensure_directory", { request: {} } satisfies SettingsEnsureDirectoryPayload);
}

export async function writeManagedConfigAtomic(contents: string): Promise<void> {
  if (!isTauriRuntimeAvailable()) {
    return;
  }
  await invoke("settings_write_config_atomic", {
    request: {
      contents,
    },
  } satisfies SettingsWriteConfigAtomicPayload);
}

export async function readRuntimeStateFile(fileName: string): Promise<string | null> {
  if (!isTauriRuntimeAvailable()) {
    return null;
  }
  const contents = await invoke<string | null>("settings_read_text_file", {
    request: {
      fileName,
    },
  } satisfies SettingsReadTextFilePayload);
  return contents ?? null;
}

export async function writeRuntimeStateFileAtomic(fileName: string, contents: string): Promise<void> {
  if (!isTauriRuntimeAvailable()) {
    return;
  }
  await invoke("settings_write_text_file_atomic", {
    request: {
      fileName,
      contents,
    },
  } satisfies SettingsWriteTextFileAtomicPayload);
}

export async function captureAndCommitCookies(request: {
  browser?: "chromium" | "firefox" | "webkit";
}): Promise<CookieCaptureAndCommitResult> {
  if (!isTauriRuntimeAvailable()) {
    return {
      status: "missing-runtime",
      exitCode: null,
      diagnostics: ["Tauri runtime is unavailable."],
      error: "tauri-runtime-unavailable",
    };
  }
  return invoke<CookieCaptureAndCommitResult>("cookie_capture_and_commit", {
    request,
  } satisfies CookieCaptureAndCommitPayload);
}

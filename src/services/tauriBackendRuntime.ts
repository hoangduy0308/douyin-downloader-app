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
  request: {
    path: string;
  };
}

interface SettingsWriteConfigAtomicPayload {
  request: {
    path: string;
    contents: string;
  };
}

interface SettingsReadTextFilePayload {
  request: {
    path: string;
  };
}

interface SettingsWriteTextFileAtomicPayload {
  request: {
    path: string;
    contents: string;
  };
}

interface RuntimePathsResponse {
  managedConfigPath: string;
}

interface CookieCaptureAndCommitPayload {
  request: {
    backendRoot: string;
    managedConfigPath: string;
    outputPath: string;
    pythonExecutable?: string;
    browser?: "chromium" | "firefox" | "webkit";
  };
}

export interface CookieCaptureAndCommitResult {
  status: "success" | "cancelled" | "missing-runtime" | "failed";
  exitCode: number | null;
  diagnostics: string[];
  cookies?: Record<string, string> | null;
  error?: string | null;
}

export function isTauriRuntimeAvailable(): boolean {
  return isTauri();
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
  if (!isTauri()) {
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
  if (!isTauri()) {
    return;
  }
  await invoke("settings_ensure_directory", {
    request: {
      path,
    },
  } satisfies SettingsEnsureDirectoryPayload);
}

export async function writeManagedConfigAtomic(path: string, contents: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("settings_write_config_atomic", {
    request: {
      path,
      contents,
    },
  } satisfies SettingsWriteConfigAtomicPayload);
}

export async function readRuntimeStateFile(path: string): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const contents = await invoke<string | null>("settings_read_text_file", {
    request: {
      path,
    },
  } satisfies SettingsReadTextFilePayload);
  return contents ?? null;
}

export async function writeRuntimeStateFileAtomic(path: string, contents: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke("settings_write_text_file_atomic", {
    request: {
      path,
      contents,
    },
  } satisfies SettingsWriteTextFileAtomicPayload);
}

export async function captureAndCommitCookies(request: {
  backendRoot: string;
  managedConfigPath: string;
  outputPath: string;
  pythonExecutable?: string;
  browser?: "chromium" | "firefox" | "webkit";
}): Promise<CookieCaptureAndCommitResult> {
  if (!isTauri()) {
    return {
      status: "missing-runtime",
      exitCode: null,
      diagnostics: ["Tauri runtime is unavailable."],
      cookies: null,
      error: "tauri-runtime-unavailable",
    };
  }
  return invoke<CookieCaptureAndCommitResult>("cookie_capture_and_commit", {
    request,
  } satisfies CookieCaptureAndCommitPayload);
}

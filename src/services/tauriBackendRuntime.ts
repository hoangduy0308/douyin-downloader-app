import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BackendDiagnostic, BackendRuntime, BackendRuntimeStartRequest } from "./backendLifecycle";

interface BackendStartPayload {
  request: {
    mode: "dev-python" | "attach";
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

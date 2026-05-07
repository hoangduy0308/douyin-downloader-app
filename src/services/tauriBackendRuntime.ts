import { invoke } from "@tauri-apps/api/core";
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

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

export function isTauriRuntimeAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI__ !== "undefined";
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

import { captureAndCommitCookies } from "./tauriBackendRuntime";

export type CookieRecoveryStatus = "success" | "cancelled" | "missing-runtime" | "failed";

export interface CookieRecoveryCommandRequest {
  browser?: "chromium" | "firefox" | "webkit";
}

export interface CookieRecoveryCommandResult {
  status: CookieRecoveryStatus;
  exitCode: number | null;
  diagnostics: string[];
  error?: string | null;
}

export interface CookieRecoveryGateway {
  captureAndCommit(request: CookieRecoveryCommandRequest): Promise<CookieRecoveryCommandResult>;
}

export interface CookieRecoveryResult {
  status: CookieRecoveryStatus;
  primaryMessage: string;
  diagnostics: string[];
}

/**
 * Cross-layer contract with the native `cookie_capture_and_commit` command:
 * Rust emits one of success|cancelled|missing-runtime|failed, and renderer
 * maps each status to a fixed actionable message without exposing cookie values.
 */
const COOKIE_RECOVERY_PRIMARY_MESSAGES: Record<CookieRecoveryStatus, string> = {
  "missing-runtime":
    "Automatic cookie recovery is unavailable on this machine. Use manual/import cookies and retry.",
  cancelled: "Cookie recovery was canceled. Existing cookies were unchanged.",
  failed: "Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.",
  success: "Cookies were refreshed. Retry the failed download now.",
};

export class TauriCookieRecoveryGateway implements CookieRecoveryGateway {
  public async captureAndCommit(
    request: CookieRecoveryCommandRequest,
  ): Promise<CookieRecoveryCommandResult> {
    return captureAndCommitCookies(request);
  }
}

export class CookieRecoveryService {
  public constructor(private readonly gateway: CookieRecoveryGateway) {}

  public async captureAndCommit(
    request: CookieRecoveryCommandRequest,
  ): Promise<CookieRecoveryResult> {
    const result = await this.gateway.captureAndCommit(request);
    if (result.status === "success") {
      return {
        status: "success",
        primaryMessage: COOKIE_RECOVERY_PRIMARY_MESSAGES.success,
        diagnostics: [...result.diagnostics],
      };
    }

    if (result.status === "missing-runtime") {
      return {
        status: "missing-runtime",
        primaryMessage: COOKIE_RECOVERY_PRIMARY_MESSAGES["missing-runtime"],
        diagnostics: [...result.diagnostics],
      };
    }

    if (result.status === "cancelled") {
      return {
        status: "cancelled",
        primaryMessage: COOKIE_RECOVERY_PRIMARY_MESSAGES.cancelled,
        diagnostics: [...result.diagnostics],
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        primaryMessage: COOKIE_RECOVERY_PRIMARY_MESSAGES.failed,
        diagnostics: [...result.diagnostics],
      };
    }

    return {
      status: "failed",
      primaryMessage:
        "Cookie recovery returned an unexpected status. Check Logs and use manual/import fallback.",
      diagnostics: [
        ...result.diagnostics,
        `Cookie recovery contract mismatch: unexpected status '${String(result.status)}'.`,
      ],
    };
  }
}

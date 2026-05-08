import { captureAndCommitCookies } from "./tauriBackendRuntime";

export const REQUIRED_COOKIE_KEYS = [
  "msToken",
  "ttwid",
  "odin_tt",
  "passport_csrf_token",
] as const;

export type CookieRecoveryStatus = "success" | "cancelled" | "missing-runtime" | "failed";

export interface CookieRecoveryCommandRequest {
  backendRoot: string;
  managedConfigPath: string;
  outputPath: string;
  pythonExecutable?: string;
  browser?: "chromium" | "firefox" | "webkit";
}

export interface CookieRecoveryCommandResult {
  status: CookieRecoveryStatus;
  exitCode: number | null;
  diagnostics: string[];
  cookies?: Record<string, string> | null;
  error?: string | null;
}

export interface CookieRecoveryGateway {
  captureAndCommit(request: CookieRecoveryCommandRequest): Promise<CookieRecoveryCommandResult>;
}

export interface CookieRecoveryResult {
  status: CookieRecoveryStatus;
  primaryMessage: string;
  diagnostics: string[];
  cookies: Record<string, string>;
}

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
    const diagnostics = [...result.diagnostics];

    if (result.status === "missing-runtime") {
      return {
        status: "missing-runtime",
        primaryMessage:
          "Automatic cookie recovery is unavailable on this machine. Use manual/import cookies and retry.",
        diagnostics,
        cookies: {},
      };
    }

    if (result.status === "cancelled") {
      return {
        status: "cancelled",
        primaryMessage: "Cookie recovery was canceled. Existing cookies were unchanged.",
        diagnostics,
        cookies: {},
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        primaryMessage:
          "Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.",
        diagnostics,
        cookies: {},
      };
    }

    const cookies = sanitizeCookies(result.cookies ?? {});
    const missingKeys = REQUIRED_COOKIE_KEYS.filter((key) => !cookies[key]);
    if (missingKeys.length > 0) {
      diagnostics.push(`Missing required cookie keys: ${missingKeys.join(", ")}`);
      return {
        status: "failed",
        primaryMessage:
          "Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.",
        diagnostics,
        cookies: {},
      };
    }

    return {
      status: "success",
      primaryMessage: "Cookies were refreshed. Retry the failed download now.",
      diagnostics,
      cookies,
    };
  }
}

function sanitizeCookies(input: Record<string, string>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) {
      continue;
    }
    cleaned[trimmedKey] = trimmedValue;
  }
  return cleaned;
}

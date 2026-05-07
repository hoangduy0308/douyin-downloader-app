const BACKEND_NOT_READY_MESSAGE =
  "Downloader backend is not ready. Restart the app backend and try again.";
const MISSING_JOB_MESSAGE =
  "This download job is no longer available. Start the download again.";
const UNSUPPORTED_URL_MESSAGE = "This link is not supported by the current downloader.";
const COOKIE_MESSAGE =
  "Douyin login cookies may be missing or expired. Cookie recovery is planned for a later phase; update cookies manually for now.";
const GENERIC_FAILURE_MESSAGE = "Download failed. Check diagnostics for technical details.";

export interface FriendlyError {
  message: string;
  diagnostics: string;
}

export function mapPollingRequestError(error: unknown): FriendlyError {
  const diagnostics = toDiagnostics(error);
  const lowered = diagnostics.toLowerCase();
  const statusCode = getStatusCode(error);

  if (
    statusCode === 404 ||
    lowered.includes("404") ||
    lowered.includes("not found")
  ) {
    return {
      message: MISSING_JOB_MESSAGE,
      diagnostics,
    };
  }

  if (
    lowered.includes("timeout") ||
    lowered.includes("network") ||
    lowered.includes("failed to fetch") ||
    lowered.includes("econnrefused") ||
    lowered.includes("503")
  ) {
    return {
      message: BACKEND_NOT_READY_MESSAGE,
      diagnostics,
    };
  }

  return {
    message: GENERIC_FAILURE_MESSAGE,
    diagnostics,
  };
}

export function mapFailedJobError(rawError: string | null): FriendlyError | null {
  if (!rawError || rawError.trim().length === 0) {
    return null;
  }

  const diagnostics = rawError;
  const lowered = rawError.toLowerCase();
  if (lowered.includes("unsupported url")) {
    return {
      message: UNSUPPORTED_URL_MESSAGE,
      diagnostics,
    };
  }

  if (
    lowered.includes("cookie") ||
    lowered.includes("mstoken") ||
    lowered.includes("ttwid") ||
    lowered.includes("login") ||
    lowered.includes("401") ||
    lowered.includes("403")
  ) {
    return {
      message: COOKIE_MESSAGE,
      diagnostics,
    };
  }

  return {
    message: GENERIC_FAILURE_MESSAGE,
    diagnostics,
  };
}

function toDiagnostics(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const statusCode = getStatusCode(error);
    if (statusCode !== null) {
      const detail = getDetail(error);
      return detail ? `${statusCode} ${detail}` : String(statusCode);
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown polling error";
  }
}

function getStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return null;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function getDetail(error: object): string {
  if (!("detail" in error)) {
    return "";
  }
  const detail = (error as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : "";
}

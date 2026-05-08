export type BatchRowStatus = "waiting" | "running" | "success" | "failed" | "skipped";

export type BatchRowSkipReason =
  | "blank"
  | "invalid_url"
  | "unsupported_host"
  | "duplicate";

export interface BatchQueueRow {
  id: string;
  sourceText: string;
  normalizedUrl: string | null;
  status: BatchRowStatus;
  skipReason: BatchRowSkipReason | null;
  retryEligible: boolean;
  attempt: number;
  currentJobId: string | null;
  lastJobId: string | null;
  lastError: string | null;
}

export interface BatchQueueTotals {
  total: number;
  waiting: number;
  running: number;
  success: number;
  failed: number;
  skipped: number;
  retryEligible: number;
  readyToSubmit: number;
}

export interface BatchQueueParseResult {
  rows: BatchQueueRow[];
  totals: BatchQueueTotals;
}

const SUPPORTED_HOSTS = ["douyin.com", "iesdouyin.com"] as const;

export function parseBatchQueueInput(text: string): BatchQueueParseResult {
  const lines = text.split(/\r?\n/);
  const seenUrls = new Set<string>();
  const rows = lines.map((line, index) => {
    const sourceText = line.trim();

    if (sourceText.length === 0) {
      return createSkippedRow(index, sourceText, "blank");
    }

      const parsedUrl = tryParseUrl(sourceText);
      if (parsedUrl === null) {
        return createSkippedRow(index, sourceText, "invalid_url");
      }

      if (!isSupportedScheme(parsedUrl.protocol)) {
        return createSkippedRow(index, sourceText, "unsupported_host");
      }

      if (!isSupportedHost(parsedUrl.hostname)) {
        return createSkippedRow(index, sourceText, "unsupported_host");
      }

    const normalizedUrl = normalizeUrl(parsedUrl);
    if (seenUrls.has(normalizedUrl)) {
      return createSkippedRow(index, sourceText, "duplicate", normalizedUrl);
    }

    seenUrls.add(normalizedUrl);
    return {
      id: `row-${index + 1}`,
      sourceText,
      normalizedUrl,
      status: "waiting",
      skipReason: null,
      retryEligible: false,
      attempt: 0,
      currentJobId: null,
      lastJobId: null,
      lastError: null,
    } satisfies BatchQueueRow;
  });

  return {
    rows,
    totals: summarizeBatchQueue(rows),
  };
}

export function summarizeBatchQueue(rows: BatchQueueRow[]): BatchQueueTotals {
  return rows.reduce<BatchQueueTotals>(
    (totals, row) => {
      totals.total += 1;
      totals[row.status] += 1;
      totals.retryEligible += row.retryEligible ? 1 : 0;
      totals.readyToSubmit += row.status === "waiting" ? 1 : 0;
      return totals;
    },
    {
      total: 0,
      waiting: 0,
      running: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      retryEligible: 0,
      readyToSubmit: 0,
    },
  );
}

export function isBatchRowRetryEligible(row: BatchQueueRow): boolean {
  return (
    row.retryEligible &&
    row.status === "failed" &&
    row.normalizedUrl !== null &&
    row.currentJobId === null
  );
}

function createSkippedRow(
  index: number,
  sourceText: string,
  skipReason: BatchRowSkipReason,
  normalizedUrl: string | null = null,
): BatchQueueRow {
  return {
    id: `row-${index + 1}`,
    sourceText,
    normalizedUrl,
    status: "skipped",
    skipReason,
    retryEligible: false,
    attempt: 0,
    currentJobId: null,
    lastJobId: null,
    lastError: null,
  };
}

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function isSupportedHost(hostname: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  return SUPPORTED_HOSTS.some((host) => {
    return normalizedHost === host || normalizedHost.endsWith(`.${host}`);
  });
}

function isSupportedScheme(protocol: string): boolean {
  const normalizedProtocol = protocol.trim().toLowerCase();
  return normalizedProtocol === "http:" || normalizedProtocol === "https:";
}

function normalizeUrl(url: URL): string {
  const canonical = new URL(url.toString());
  canonical.hash = "";
  canonical.hostname = canonical.hostname.toLowerCase();
  if (canonical.pathname.length > 1) {
    canonical.pathname = canonical.pathname.replace(/\/+$/, "");
  }
  return canonical.toString();
}

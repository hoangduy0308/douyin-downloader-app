export type HistoryEntryMode = "single" | "batch-row" | "batch-queue";

export type HistoryEntryStatus = "success" | "failed" | "cancelled" | "skipped";

export interface HistoryEntry {
  logicalId: string;
  mode: HistoryEntryMode;
  url: string;
  status: HistoryEntryStatus;
  outputPath: string | null;
  resultLocation: string | null;
  errorSummary: string | null;
  finishedAt: string;
  recordedAt: string;
}

export interface HistoryEntryUpsertInput {
  logicalId: string;
  mode: HistoryEntryMode;
  url: string;
  status: HistoryEntryStatus;
  outputPath: string | null;
  resultLocation: string | null;
  errorSummary: string | null;
  finishedAt: string;
  recordedAt: string;
}

export interface HistoryFileStore {
  read(): Promise<string | null>;
  write(nextContents: string): Promise<void>;
}

export interface HistoryDiagnosticEvent {
  source: "history-store";
  action: "load-read" | "load-parse" | "write";
  message: string;
}

interface HistoryStoreOptions {
  fileStore: HistoryFileStore;
  maxEntries?: number;
  onDiagnostic?: (event: HistoryDiagnosticEvent) => void;
}

interface PersistedHistoryDocument {
  schemaVersion: 1;
  entries: HistoryEntry[];
}

const HISTORY_SCHEMA_VERSION = 1;
const DEFAULT_HISTORY_MAX_ENTRIES = 200;

export class AppHistoryStore {
  private readonly fileStore: HistoryFileStore;
  private readonly maxEntries: number;
  private readonly onDiagnostic?: (event: HistoryDiagnosticEvent) => void;
  private loaded = false;
  private entries: HistoryEntry[] = [];

  public constructor(options: HistoryStoreOptions) {
    this.fileStore = options.fileStore;
    this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES));
    this.onDiagnostic = options.onDiagnostic;
  }

  public async load(): Promise<HistoryEntry[]> {
    this.loaded = true;
    try {
      const raw = await this.fileStore.read();
      if (raw === null || raw.trim().length === 0) {
        this.entries = [];
        return this.list();
      }
      this.entries = this.deserialize(raw);
      if (this.entries.length > this.maxEntries) {
        this.entries = applyRetention(this.entries, this.maxEntries);
        await this.persist();
      }
    } catch (error) {
      this.entries = [];
      const message = error instanceof Error ? error.message : String(error);
      this.emitDiagnostic("load-read", message);
    }
    return this.list();
  }

  public list(): HistoryEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  public async upsert(input: HistoryEntryUpsertInput): Promise<HistoryEntry[]> {
    await this.ensureLoaded();

    const nextEntry = normalizeEntry(input);
    const existingIndex = this.entries.findIndex((entry) => entry.logicalId === nextEntry.logicalId);
    if (existingIndex >= 0) {
      this.entries[existingIndex] = nextEntry;
    } else {
      this.entries.push(nextEntry);
    }

    this.entries = applyRetention(this.entries, this.maxEntries);
    await this.persist();
    return this.list();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.load();
  }

  private deserialize(raw: string): HistoryEntry[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitDiagnostic("load-parse", message);
      return [];
    }

    if (typeof parsed !== "object" || parsed === null) {
      this.emitDiagnostic("load-parse", "History document must be an object.");
      return [];
    }

    const document = parsed as Partial<PersistedHistoryDocument>;
    if (document.schemaVersion !== HISTORY_SCHEMA_VERSION || !Array.isArray(document.entries)) {
      this.emitDiagnostic("load-parse", "Unsupported history schema or entries payload.");
      return [];
    }

    const normalizedEntries: HistoryEntry[] = [];
    for (const candidate of document.entries) {
      try {
        normalizedEntries.push(normalizeEntry(candidate));
      } catch {
        this.emitDiagnostic("load-parse", "Skipped malformed history entry.");
      }
    }

    return applyRetention(normalizedEntries, this.maxEntries);
  }

  private async persist(): Promise<void> {
    const payload: PersistedHistoryDocument = {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      entries: this.entries,
    };
    try {
      await this.fileStore.write(JSON.stringify(payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitDiagnostic("write", message);
    }
  }

  private emitDiagnostic(action: HistoryDiagnosticEvent["action"], message: string): void {
    this.onDiagnostic?.({
      source: "history-store",
      action,
      message,
    });
  }
}

function normalizeEntry(input: HistoryEntryUpsertInput | HistoryEntry): HistoryEntry {
  return {
    logicalId: toNonEmptyString(input.logicalId, "logicalId"),
    mode: parseMode(input.mode),
    url: toNonEmptyString(input.url, "url"),
    status: parseStatus(input.status),
    outputPath: toNullableString(input.outputPath),
    resultLocation: toNullableString(input.resultLocation),
    errorSummary: toNullableString(input.errorSummary),
    finishedAt: toIsoString(input.finishedAt, "finishedAt"),
    recordedAt: toIsoString(input.recordedAt, "recordedAt"),
  };
}

function parseMode(value: string): HistoryEntryMode {
  if (value === "single" || value === "batch-row" || value === "batch-queue") {
    return value;
  }
  throw new Error(`Unsupported history mode: ${value}`);
}

function parseStatus(value: string): HistoryEntryStatus {
  if (value === "success" || value === "failed" || value === "cancelled" || value === "skipped") {
    return value;
  }
  throw new Error(`Unsupported history status: ${value}`);
}

function toNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return String(value);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : value;
}

function toIsoString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty ISO timestamp string.`);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${fieldName} must be parseable as a timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function applyRetention(entries: HistoryEntry[], maxEntries: number): HistoryEntry[] {
  return [...entries]
    .sort((left, right) => {
      const rightTime = sortTimestamp(right);
      const leftTime = sortTimestamp(left);
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return left.logicalId.localeCompare(right.logicalId);
    })
    .slice(0, maxEntries);
}

function sortTimestamp(entry: HistoryEntry): number {
  const recordedAt = Date.parse(entry.recordedAt);
  const finishedAt = Date.parse(entry.finishedAt);
  if (Number.isNaN(recordedAt) && Number.isNaN(finishedAt)) {
    return 0;
  }
  if (Number.isNaN(recordedAt)) {
    return finishedAt;
  }
  if (Number.isNaN(finishedAt)) {
    return recordedAt;
  }
  return Math.max(recordedAt, finishedAt);
}
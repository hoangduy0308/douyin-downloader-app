import { describe, expect, it } from "vitest";
import { AppHistoryStore, type HistoryFileStore } from "../services/historyStore";

class InMemoryHistoryFileStore implements HistoryFileStore {
  public contents: string | null = null;
  public failWrite = false;
  public failRead = false;

  public async read(): Promise<string | null> {
    if (this.failRead) {
      throw new Error("read failed");
    }
    return this.contents;
  }

  public async write(nextContents: string): Promise<void> {
    if (this.failWrite) {
      throw new Error("write failed");
    }
    this.contents = nextContents;
  }
}

describe("AppHistoryStore", () => {
  it("persists entries and reloads them across store instances", async () => {
    const fileStore = new InMemoryHistoryFileStore();
    const writer = new AppHistoryStore({ fileStore });

    await writer.load();
    await writer.upsert({
      logicalId: "single:https://www.douyin.com/video/1",
      mode: "single",
      url: "https://www.douyin.com/video/1",
      status: "success",
      outputPath: "C:\\Downloads",
      resultLocation: "C:\\Downloads\\video-1.mp4",
      errorSummary: null,
      finishedAt: "2026-05-09T02:00:00.000Z",
      recordedAt: "2026-05-09T02:00:00.000Z",
    });

    const reader = new AppHistoryStore({ fileStore });
    await reader.load();

    expect(reader.list()).toHaveLength(1);
    expect(reader.list()[0]).toMatchObject({
      logicalId: "single:https://www.douyin.com/video/1",
      mode: "single",
      status: "success",
      outputPath: "C:\\Downloads",
      resultLocation: "C:\\Downloads\\video-1.mp4",
    });
  });

  it("loads missing history file as empty without crashing", async () => {
    const fileStore = new InMemoryHistoryFileStore();
    const diagnostics: string[] = [];
    const store = new AppHistoryStore({
      fileStore,
      onDiagnostic: (event) => diagnostics.push(`${event.action}:${event.message}`),
    });

    const loadedEntries = await store.load();

    expect(loadedEntries).toEqual([]);
    expect(store.list()).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("handles malformed history payloads safely and reports parse diagnostics", async () => {
    const fileStore = new InMemoryHistoryFileStore();
    fileStore.contents = "{not valid json";
    const diagnostics: string[] = [];
    const store = new AppHistoryStore({
      fileStore,
      onDiagnostic: (event) => diagnostics.push(`${event.action}:${event.message}`),
    });

    await store.load();

    expect(store.list()).toEqual([]);
    expect(diagnostics.some((entry) => entry.startsWith("load-parse:"))).toBe(true);
  });

  it("upserts by stable logical id without creating duplicates", async () => {
    const fileStore = new InMemoryHistoryFileStore();
    const store = new AppHistoryStore({ fileStore });
    await store.load();

    await store.upsert({
      logicalId: "batch:run-1:row-1",
      mode: "batch-row",
      url: "https://www.douyin.com/video/row-1",
      status: "failed",
      outputPath: "C:\\Downloads",
      resultLocation: null,
      errorSummary: "cookie expired",
      finishedAt: "2026-05-09T02:10:00.000Z",
      recordedAt: "2026-05-09T02:10:00.000Z",
    });
    await store.upsert({
      logicalId: "batch:run-1:row-1",
      mode: "batch-row",
      url: "https://www.douyin.com/video/row-1",
      status: "success",
      outputPath: "C:\\Downloads",
      resultLocation: "C:\\Downloads\\row-1.mp4",
      errorSummary: null,
      finishedAt: "2026-05-09T02:12:00.000Z",
      recordedAt: "2026-05-09T02:12:00.000Z",
    });

    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      logicalId: "batch:run-1:row-1",
      status: "success",
      resultLocation: "C:\\Downloads\\row-1.mp4",
      errorSummary: null,
    });
  });

  it("caps retained history at 200 entries and keeps newest first", async () => {
    const entries = Array.from({ length: 205 }, (_, index) => {
      const timestamp = new Date(Date.UTC(2026, 4, 9, 1, index, 0, 0)).toISOString();
      return {
        logicalId: `single:${index}`,
        mode: "single" as const,
        url: `https://www.douyin.com/video/${index}`,
        status: "success" as const,
        outputPath: "C:\\Downloads",
        resultLocation: `C:\\Downloads\\${index}.mp4`,
        errorSummary: null,
        finishedAt: timestamp,
        recordedAt: timestamp,
      };
    });
    const fileStore = new InMemoryHistoryFileStore();
    fileStore.contents = JSON.stringify({
      schemaVersion: 1,
      entries,
    });
    const store = new AppHistoryStore({ fileStore });

    await store.load();
    const history = store.list();

    expect(history).toHaveLength(200);
    expect(history[0].logicalId).toBe("single:204");
    expect(history[199].logicalId).toBe("single:5");
  });

  it("reports write diagnostics but keeps in-memory state if persistence fails", async () => {
    const fileStore = new InMemoryHistoryFileStore();
    const diagnostics: string[] = [];
    const store = new AppHistoryStore({
      fileStore,
      onDiagnostic: (event) => diagnostics.push(`${event.action}:${event.message}`),
    });
    await store.load();
    fileStore.failWrite = true;

    await store.upsert({
      logicalId: "single:https://www.douyin.com/video/write-error",
      mode: "single",
      url: "https://www.douyin.com/video/write-error",
      status: "failed",
      outputPath: "C:\\Downloads",
      resultLocation: null,
      errorSummary: "disk full",
      finishedAt: "2026-05-09T03:00:00.000Z",
      recordedAt: "2026-05-09T03:00:00.000Z",
    });

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].logicalId).toBe("single:https://www.douyin.com/video/write-error");
    expect(diagnostics.some((entry) => entry.startsWith("write:"))).toBe(true);
  });
});

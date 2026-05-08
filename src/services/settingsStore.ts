export interface RuntimeSettingsSnapshot {
  configPath: string;
  outputPath: string;
  advancedOptions: RuntimeAdvancedOptions;
  configVersion: number;
  backendReadyConfigVersion: number;
}

export interface RuntimeConfigWriter {
  resolveManagedConfigPath(): Promise<string>;
  resolveDefaultOutputPath(): Promise<string>;
  ensureDirectory(path: string): Promise<void>;
  writeConfigAtomic(path: string, contents: string): Promise<void>;
  persistOutputPath?(path: string): Promise<void>;
}

export type SupportedDownloadMode = "post" | "like" | "mix" | "music" | "collect" | "collectmix";

export interface RuntimeAdvancedOptions {
  music: boolean;
  cover: boolean;
  avatar: boolean;
  json: boolean;
  folderstyle: boolean;
  thread: number;
  retry_times: number;
  proxy: string;
  browser_fallback: {
    enabled: boolean;
    headless: boolean;
    max_scrolls: number;
    idle_rounds: number;
    wait_timeout_seconds: number;
  };
  mode: SupportedDownloadMode[];
  number: Record<SupportedDownloadMode, number>;
  increase: {
    post: boolean;
    like: boolean;
    mix: boolean;
    music: boolean;
  };
}

const DEFAULT_RUNTIME_ADVANCED_OPTIONS: RuntimeAdvancedOptions = {
  music: true,
  cover: true,
  avatar: true,
  json: true,
  folderstyle: true,
  thread: 5,
  retry_times: 3,
  proxy: "",
  browser_fallback: {
    enabled: true,
    headless: false,
    max_scrolls: 240,
    idle_rounds: 8,
    wait_timeout_seconds: 600,
  },
  mode: ["post"],
  number: {
    post: 0,
    like: 0,
    mix: 0,
    music: 0,
    collect: 0,
    collectmix: 0,
  },
  increase: {
    post: false,
    like: false,
    mix: false,
    music: false,
  },
};

export class RuntimeSettingsStore {
  private state: RuntimeSettingsSnapshot | null = null;

  public constructor(private readonly writer: RuntimeConfigWriter) {}

  public async initialize(): Promise<RuntimeSettingsSnapshot> {
    if (this.state) {
      return this.snapshot();
    }

    const configPath = await this.writer.resolveManagedConfigPath();
    assertWindowsSafeAbsolutePath(configPath, "Managed config path must be a Windows absolute path");
    assertManagedConfigPath(configPath);

    const outputPath = await this.writer.resolveDefaultOutputPath();
    assertWindowsSafeAbsolutePath(outputPath, "Output path must be a Windows absolute path");
    const advancedOptions = createDefaultRuntimeAdvancedOptions();

    await this.writer.ensureDirectory(outputPath);
    await this.writer.writeConfigAtomic(configPath, serializeRuntimeConfig(outputPath, advancedOptions));

    this.state = {
      configPath,
      outputPath,
      advancedOptions,
      configVersion: 1,
      backendReadyConfigVersion: 0,
    };
    return this.snapshot();
  }

  public async updateOutputPath(nextOutputPath: string): Promise<RuntimeSettingsSnapshot> {
    if (!this.state) {
      await this.initialize();
    }
    const current = this.state as RuntimeSettingsSnapshot;
    assertWindowsSafeAbsolutePath(nextOutputPath, "Output path must be a Windows absolute path");

    if (nextOutputPath === current.outputPath) {
      return this.snapshot();
    }

    await this.writer.ensureDirectory(nextOutputPath);
    await this.writer.writeConfigAtomic(
      current.configPath,
      serializeRuntimeConfig(nextOutputPath, current.advancedOptions),
    );
    await this.writer.persistOutputPath?.(nextOutputPath);

    this.state = {
      ...current,
      outputPath: nextOutputPath,
      configVersion: current.configVersion + 1,
    };
    return this.snapshot();
  }

  public async updateAdvancedOptions(
    patch: Partial<RuntimeAdvancedOptions>,
  ): Promise<RuntimeSettingsSnapshot> {
    if (!this.state) {
      await this.initialize();
    }
    const current = this.state as RuntimeSettingsSnapshot;
    const advancedOptions = mergeAdvancedOptions(current.advancedOptions, patch);

    await this.writer.writeConfigAtomic(
      current.configPath,
      serializeRuntimeConfig(current.outputPath, advancedOptions),
    );

    this.state = {
      ...current,
      advancedOptions,
      configVersion: current.configVersion + 1,
    };
    return this.snapshot();
  }

  public markBackendReadyForCurrentConfig(): void {
    if (!this.state) {
      return;
    }
    this.state = {
      ...this.state,
      backendReadyConfigVersion: this.state.configVersion,
    };
  }

  public isReadyForSubmit(): boolean {
    if (!this.state) {
      return false;
    }
    return this.state.configVersion === this.state.backendReadyConfigVersion;
  }

  public snapshot(): RuntimeSettingsSnapshot {
    if (!this.state) {
      throw new Error("Runtime settings store is not initialized.");
    }
    return { ...this.state };
  }
}

export function serializeRuntimeConfig(
  outputPath: string,
  advancedOptions: RuntimeAdvancedOptions = DEFAULT_RUNTIME_ADVANCED_OPTIONS,
): string {
  assertWindowsSafeAbsolutePath(outputPath, "Output path must be a Windows absolute path");
  const escapedProxy = advancedOptions.proxy.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const modeLines = advancedOptions.mode.map((item) => `  - ${item}`).join("\n");
  return [
    `path: ${outputPath}`,
    "",
    `music: ${advancedOptions.music}`,
    `cover: ${advancedOptions.cover}`,
    `avatar: ${advancedOptions.avatar}`,
    `json: ${advancedOptions.json}`,
    "",
    `folderstyle: ${advancedOptions.folderstyle}`,
    "",
    "mode:",
    modeLines,
    "",
    "number:",
    `  post: ${advancedOptions.number.post}`,
    `  like: ${advancedOptions.number.like}`,
    `  mix: ${advancedOptions.number.mix}`,
    `  music: ${advancedOptions.number.music}`,
    `  collect: ${advancedOptions.number.collect}`,
    `  collectmix: ${advancedOptions.number.collectmix}`,
    "",
    "increase:",
    `  post: ${advancedOptions.increase.post}`,
    `  like: ${advancedOptions.increase.like}`,
    `  mix: ${advancedOptions.increase.mix}`,
    `  music: ${advancedOptions.increase.music}`,
    "",
    `thread: ${advancedOptions.thread}`,
    `retry_times: ${advancedOptions.retry_times}`,
    `proxy: "${escapedProxy}"`,
    "",
    "browser_fallback:",
    `  enabled: ${advancedOptions.browser_fallback.enabled}`,
    `  headless: ${advancedOptions.browser_fallback.headless}`,
    `  max_scrolls: ${advancedOptions.browser_fallback.max_scrolls}`,
    `  idle_rounds: ${advancedOptions.browser_fallback.idle_rounds}`,
    `  wait_timeout_seconds: ${advancedOptions.browser_fallback.wait_timeout_seconds}`,
    "",
  ].join("\n");
}

function assertManagedConfigPath(path: string): void {
  const normalized = normalizeWindowsLikePath(path);
  if (normalized.endsWith("\\config.yml") || normalized.endsWith("\\config.example.yml")) {
    throw new Error("Managed config path must not target bundled backend config files");
  }
  if (normalized.includes("\\douyin-downloader\\config\\")) {
    throw new Error("Managed config path must stay outside backend config directories");
  }
}

function assertWindowsSafeAbsolutePath(path: string, message: string): void {
  if (!isWindowsSafeAbsolutePath(path)) {
    throw new Error(message);
  }
}

export function isWindowsSafeAbsolutePath(path: string): boolean {
  if (path.includes("\0")) {
    return false;
  }
  if (path.includes("/")) {
    return false;
  }
  if (path.includes("\\..\\") || path.endsWith("\\..") || path.startsWith("..\\")) {
    return false;
  }
  const windowsDriveAbsolute = /^[a-zA-Z]:[\\/]/.test(path);
  const windowsUncAbsolute = /^\\\\[^\\]+\\[^\\]+/.test(path);
  return windowsDriveAbsolute || windowsUncAbsolute;
}

function normalizeWindowsLikePath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

export function createDefaultRuntimeAdvancedOptions(): RuntimeAdvancedOptions {
  return {
    ...DEFAULT_RUNTIME_ADVANCED_OPTIONS,
    browser_fallback: { ...DEFAULT_RUNTIME_ADVANCED_OPTIONS.browser_fallback },
    mode: [...DEFAULT_RUNTIME_ADVANCED_OPTIONS.mode],
    number: { ...DEFAULT_RUNTIME_ADVANCED_OPTIONS.number },
    increase: { ...DEFAULT_RUNTIME_ADVANCED_OPTIONS.increase },
  };
}

function mergeAdvancedOptions(
  current: RuntimeAdvancedOptions,
  patch: Partial<RuntimeAdvancedOptions>,
): RuntimeAdvancedOptions {
  const rawModes = patch.mode ?? current.mode;
  const mode = normalizeModes(rawModes);
  return {
    music: patch.music ?? current.music,
    cover: patch.cover ?? current.cover,
    avatar: patch.avatar ?? current.avatar,
    json: patch.json ?? current.json,
    folderstyle: patch.folderstyle ?? current.folderstyle,
    thread: clampInteger(patch.thread ?? current.thread, 1, 10),
    retry_times: clampInteger(patch.retry_times ?? current.retry_times, 0, 10),
    proxy: patch.proxy ?? current.proxy,
    browser_fallback: {
      enabled: patch.browser_fallback?.enabled ?? current.browser_fallback.enabled,
      headless: patch.browser_fallback?.headless ?? current.browser_fallback.headless,
      max_scrolls: minInteger(patch.browser_fallback?.max_scrolls ?? current.browser_fallback.max_scrolls, 0),
      idle_rounds: minInteger(patch.browser_fallback?.idle_rounds ?? current.browser_fallback.idle_rounds, 0),
      wait_timeout_seconds: minInteger(
        patch.browser_fallback?.wait_timeout_seconds ?? current.browser_fallback.wait_timeout_seconds,
        1,
      ),
    },
    mode,
    number: {
      post: minInteger(patch.number?.post ?? current.number.post, 0),
      like: minInteger(patch.number?.like ?? current.number.like, 0),
      mix: minInteger(patch.number?.mix ?? current.number.mix, 0),
      music: minInteger(patch.number?.music ?? current.number.music, 0),
      collect: minInteger(patch.number?.collect ?? current.number.collect, 0),
      collectmix: minInteger(patch.number?.collectmix ?? current.number.collectmix, 0),
    },
    increase: {
      post: patch.increase?.post ?? current.increase.post,
      like: patch.increase?.like ?? current.increase.like,
      mix: patch.increase?.mix ?? current.increase.mix,
      music: patch.increase?.music ?? current.increase.music,
    },
  };
}

function normalizeModes(candidateModes: string[]): SupportedDownloadMode[] {
  const normalized: SupportedDownloadMode[] = [];
  for (const item of candidateModes) {
    const normalizedItem = item === "allmix" ? "mix" : item;
    if (!isSupportedMode(normalizedItem)) {
      continue;
    }
    if (!normalized.includes(normalizedItem)) {
      normalized.push(normalizedItem);
    }
  }
  if (normalized.length === 0) {
    return ["post"];
  }
  return normalized;
}

function isSupportedMode(value: string): value is SupportedDownloadMode {
  return (
    value === "post" ||
    value === "like" ||
    value === "mix" ||
    value === "music" ||
    value === "collect" ||
    value === "collectmix"
  );
}

function minInteger(value: number, minimum: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.max(minimum, normalized);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, minInteger(value, minimum));
}

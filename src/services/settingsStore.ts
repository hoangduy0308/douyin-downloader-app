export interface RuntimeSettingsSnapshot {
  configPath: string;
  outputPath: string;
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

    await this.writer.ensureDirectory(outputPath);
    await this.writer.writeConfigAtomic(configPath, serializeRuntimeConfig(outputPath));

    this.state = {
      configPath,
      outputPath,
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
    await this.writer.writeConfigAtomic(current.configPath, serializeRuntimeConfig(nextOutputPath));
    await this.writer.persistOutputPath?.(nextOutputPath);

    this.state = {
      ...current,
      outputPath: nextOutputPath,
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

export function serializeRuntimeConfig(outputPath: string): string {
  assertWindowsSafeAbsolutePath(outputPath, "Output path must be a Windows absolute path");
  return `path: ${outputPath}\n`;
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

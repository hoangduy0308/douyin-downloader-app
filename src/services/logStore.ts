export type AppLogLevel = "info" | "warn" | "error";

export interface AppLogEvent {
  at: string;
  level: AppLogLevel;
  source: string;
  message: string;
  context?: Record<string, string>;
}

export interface AppLogInput {
  at?: string;
  level: AppLogLevel;
  source: string;
  message: string;
  context?: Record<string, string | number | boolean | null | undefined>;
}

export const FRONTEND_LOG_CAP = 1000;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(cookie|authorization|token|secret|password|session)/i;

export class AppLogStore {
  private readonly events: AppLogEvent[] = [];

  public constructor(private readonly cap: number = FRONTEND_LOG_CAP) {}

  public append(input: AppLogInput): AppLogEvent[] {
    this.events.push({
      at: input.at ?? new Date().toISOString(),
      level: input.level,
      source: input.source,
      message: redactMessage(input.message),
      context: redactContext(input.context),
    });
    if (this.events.length > this.cap) {
      this.events.splice(0, this.events.length - this.cap);
    }
    return this.getEventsNewestFirst();
  }

  public appendMany(inputs: AppLogInput[]): AppLogEvent[] {
    for (const input of inputs) {
      this.append(input);
    }
    return this.getEventsNewestFirst();
  }

  public clear(): AppLogEvent[] {
    this.events.length = 0;
    return [];
  }

  public getEventsNewestFirst(): AppLogEvent[] {
    return [...this.events].reverse();
  }
}

function redactContext(
  context: AppLogInput["context"],
): Record<string, string> | undefined {
  if (!context) {
    return undefined;
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
      continue;
    }
    output[key] = redactMessage(String(value));
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function redactMessage(message: string): string {
  let redacted = message;

  redacted = redacted.replace(
    /(\b(?:authorization|proxy-authorization)\b\s*[:=]\s*)([^,;\n\r]+)/gi,
    `$1${REDACTED}`,
  );
  redacted = redacted.replace(
    /(\b(?:cookie|set-cookie)\b\s*[:=]\s*)([^;\n\r]+)/gi,
    `$1${REDACTED}`,
  );
  redacted = redacted.replace(
    /(\b[\w.-]*(?:cookie|token|secret|authorization|password|session)[\w.-]*\b\s*[=:]\s*)([^\s,;]+)/gi,
    `$1${REDACTED}`,
  );

  return redacted;
}

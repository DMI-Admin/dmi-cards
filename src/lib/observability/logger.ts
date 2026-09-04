type LogLevel = "info" | "warn" | "error";

type LogContext = {
  code: string;
  requestId?: string | null;
  route?: string | null;
  metadata?: Record<string, unknown>;
};

const sensitiveKeyPattern =
  /(^|_)(authorization|cookie|email|first_name|last_name|name|password|phone|profile|secret|token|api_?key|private_?key)(_|$)/i;
const maxDepth = 4;
const maxArrayItems = 20;
const maxStringLength = 500;

export function logInfo(context: LogContext) {
  writeLog("info", context);
}

export function logWarn(context: LogContext) {
  writeLog("warn", context);
}

export function logError(context: LogContext) {
  writeLog("error", context);
}

export function safeErrorMetadata(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
  };
}

function writeLog(level: LogLevel, context: LogContext) {
  const event = {
    timestamp: new Date().toISOString(),
    level,
    code: context.code,
    requestId: context.requestId || null,
    route: context.route || null,
    metadata: sanitizeLogValue(context.metadata || {}, 0),
  };
  const serializedEvent = `[DMI] ${JSON.stringify(event)}`;

  if (level === "error") {
    console.error(serializedEvent);
    return;
  }

  if (level === "warn") {
    console.warn(serializedEvent);
    return;
  }

  console.info(serializedEvent);
}

function sanitizeLogValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.length > maxStringLength
      ? `${value.slice(0, maxStringLength)}...`
      : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (value instanceof Date) return value.toISOString();

  if (depth >= maxDepth) return "[Redacted:MaxDepth]";

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((item) => sanitizeLogValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
        key,
        sensitiveKeyPattern.test(key)
          ? "[Redacted]"
          : sanitizeLogValue(childValue, depth + 1),
      ])
    );
  }

  return String(value);
}

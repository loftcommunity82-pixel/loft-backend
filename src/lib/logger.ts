type LogLevel = "info" | "warn" | "error" | "debug"

interface LogEntry {
  level: LogLevel
  timestamp: string
  context: string
  message: string
  data?: Record<string, unknown>
  error?: unknown
}

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    context,
    message,
    ...(data ? { data } : {}),
  }
  const output = JSON.stringify(entry)
  switch (level) {
    case "error":
      console.error(output)
      break
    case "warn":
      console.warn(output)
      break
    case "debug":
      if (process.env.NODE_ENV === "development") console.debug(output)
      break
    default:
      console.log(output)
  }
}

export function createLogger(context: string) {
  return {
    info: (message: string, data?: Record<string, unknown>) => log("info", context, message, data),
    warn: (message: string, data?: Record<string, unknown>) => log("warn", context, message, data),
    error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
      const extra = error instanceof Error
        ? { error: { message: error.message, stack: error.stack, name: error.name }, ...data }
        : { error, ...data }
      log("error", context, message, extra)
    },
    debug: (message: string, data?: Record<string, unknown>) => log("debug", context, message, data),
  }
}

export type Logger = ReturnType<typeof createLogger>

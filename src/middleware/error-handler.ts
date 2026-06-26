import { Request, Response, NextFunction } from "express"
import { createLogger } from "../lib/logger"

const log = createLogger("error-handler")

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err.status || err.statusCode || 500
  const message = err.message || "Internal server error"

  if (status >= 500) {
    log.error("Unhandled error", err)
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  })
}

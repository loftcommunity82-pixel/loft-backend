import { Response, NextFunction } from "express"
import { extractToken, verifyToken } from "../lib/jwt"
import type { AuthenticatedRequest } from "../types"

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req)
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const user = verifyToken(token)
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: "Unauthorized" })
  }
}

export function optionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req)
    if (token) {
      const user = verifyToken(token)
      if (user) {
        req.user = user
      }
    }
  } catch {
    // Ignore - auth is optional
  }
  next()
}

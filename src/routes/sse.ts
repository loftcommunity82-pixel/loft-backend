import { Router, type Request, type Response } from "express"
import { extractToken, verifyToken } from "../lib/jwt"
import { addClient } from "../lib/sse"
import { db } from "../lib/db"
import { rateLimit } from "../lib/rate-limit"
import { createLogger } from "../lib/logger"

const router = Router()
const log = createLogger("sse")

router.get("/subscribe", async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || "unknown"
    const { success: withinLimit } = await rateLimit(`sse:${ip}`, 20, 60000)
    if (!withinLimit) {
      res.status(429).json({ error: "Too many connection attempts" })
      return
    }

    const token = extractToken(req)
    if (!token) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }

    const jwtUser = verifyToken(token)
    if (!jwtUser) {
      res.status(401).json({ error: "Unauthorized" })
      return
    }

    const user = await db.user.findUnique({ where: { clerkId: jwtUser.clerkId } })
    if (!user) {
      res.status(401).json({ error: "User not found" })
      return
    }

    const added = addClient(user.clerkId, res)
    if (!added) {
      res.status(429).json({ error: "Too many connections" })
      return
    }

    const keepalive = setInterval(() => {
      res.write(":keepalive\n\n")
    }, 30000)

    req.on("close", () => {
      clearInterval(keepalive)
    })
  } catch (err) {
    log.error("SSE subscribe error", err)
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" })
    }
  }
})

export default router

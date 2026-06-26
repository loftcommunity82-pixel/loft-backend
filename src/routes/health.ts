import { Router, Request, Response } from "express"
import { db } from "../lib/db"

const router = Router()

router.get("/", async (_req: Request, res: Response) => {
  try {
    await db.$queryRaw`SELECT 1`
    return res.json({
      status: "ok",
      db: "connected",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  } catch {
    return res.status(503).json({
      status: "error",
      db: "disconnected",
      timestamp: new Date().toISOString(),
    })
  }
})

export default router

import { Router, Request, Response } from "express"
import { db } from "../lib/db"

const router = Router()

// GET /api/skills/search?q=
router.get("/search", async (req: Request, res: Response) => {
  const q = (req.query.q as string) || ""
  if (q.length < 1) return res.json([])

  const skills = await db.skill.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    take: 10,
    orderBy: { name: "asc" },
  })

  return res.json(skills)
})

export default router

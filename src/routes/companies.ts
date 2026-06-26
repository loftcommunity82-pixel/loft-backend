import { Router, Response } from "express"
import { db } from "../lib/db"
import { requireAuth } from "../middleware/auth"
import { createLogger } from "../lib/logger"
import type { AuthenticatedRequest } from "../types"
import { CompanySize } from "@prisma/client"

const router = Router()
const log = createLogger("companies")

// GET /api/companies/profile
router.get("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail }, include: { employerProfile: true } })
    return res.json(user?.employerProfile || null)
  } catch (error) {
    log.error("Get company profile error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// PATCH /api/companies/profile
router.patch("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const { companyName, industry, size, description, website, city, country } = req.body
    if (!companyName || !industry || !size) return res.status(400).json({ error: "Missing required fields" })

    const profile = await db.employerProfile.upsert({
      where: { userId: user.clerkId },
      update: { companyName, industry, companySize: size as CompanySize, description, companyWebsite: website, city, country },
      create: { userId: user.clerkId, companyName, industry, companySize: size as CompanySize, description, companyWebsite: website, city, country, contactEmail: user.email },
    })
    return res.json({ success: true, profile })
  } catch (error) {
    log.error("Update company profile error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/companies/jobs
router.get("/jobs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { companyMemberships: { take: 1 } },
    })
    if (!user?.companyMemberships?.length) return res.status(401).json({ error: "Unauthorized" })

    const companyId = user.companyMemberships[0].companyId
    const status = req.query.status as string
    const assignedToMe = req.query.assignedToMe === "true"

    const where: any = { companyId }
    if (status) where.status = status
    if (assignedToMe) where.employerId = user.clerkId

    const jobs = await db.job.findMany({
      where,
      include: { employer: { select: { companyName: true, companyLogo: true, city: true, contactEmail: true } } },
      orderBy: { createdAt: "desc" },
    })
    return res.json(jobs)
  } catch (error) {
    log.error("List company jobs error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

export default router

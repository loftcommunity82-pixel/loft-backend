import { Router, Response } from "express"
import { db } from "../lib/db"
import { requireAuth } from "../middleware/auth"
import { createLogger } from "../lib/logger"
import type { AuthenticatedRequest } from "../types"

const router = Router()
const log = createLogger("admin")

// Helper: simple admin check (hardcoded company 1 / "loft-community")
async function requireAdmin(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { companyMemberships: { where: { company: { slug: "loft-community" }, role: "ADMIN" }, take: 1 } },
    })
    if (!user?.companyMemberships?.length) {
      res.status(403).json({ error: "Unauthorized" })
      return false
    }
    return true
  } catch {
    res.status(403).json({ error: "Unauthorized" })
    return false
  }
}

// GET /api/admin/analytics
router.get("/analytics", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [totalUsers, totalSeekers, totalEmployers, activeJobs, totalApplications, hiredThisMonth, pendingJobs, flaggedJobs, applicationsThisWeek] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { isApplicant: true } }),
    db.user.count({ where: { isEmployer: true } }),
    db.job.count({ where: { status: "PUBLISHED", isActive: true } }),
    db.jobApplication.count(),
    db.jobApplication.count({ where: { status: "HIRED" } }),
    db.job.count({ where: { status: "DRAFT" } }),
    db.job.count({ where: { isActive: false, status: "PUBLISHED" } }),
    db.jobApplication.count({ where: { appliedAt: { gte: weekAgo } } }),
  ])

  const hireRate = totalApplications > 0 ? Math.round((hiredThisMonth / totalApplications) * 100) : 0

  return res.json({ totalUsers, totalSeekers, totalEmployers, activeJobs, totalApplications, applicationsThisWeek, hiredThisMonth, pendingJobs, flaggedJobs, hireRate, updatedAt: new Date().toISOString() })
})

// GET /api/admin/employers
router.get("/employers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const members = await db.companyMember.findMany({
    where: { companyId: 1 },
    include: { user: { select: { id: true, clerkId: true, email: true, firstName: true, lastName: true, name: true, profileImage: true, isEmployer: true, employerProfile: { select: { companyName: true, industry: true, contactEmail: true } } } } },
    orderBy: { createdAt: "asc" },
  })

  return res.json(members.map(m => ({
    id: m.id, userId: m.userId, role: m.role, createdAt: m.createdAt,
    user: { clerkId: m.user.clerkId, email: m.user.email, firstName: m.user.firstName, lastName: m.user.lastName, name: m.user.name, profileImage: m.user.profileImage, isEmployer: m.user.isEmployer, companyName: m.user.employerProfile?.companyName || null, industry: m.user.employerProfile?.industry || null },
  })))
})

// POST /api/admin/employers
router.post("/employers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const { email, role } = req.body
  if (!email) return res.status(400).json({ error: "Email required" })

  const user = await db.user.findUnique({ where: { email } })
  if (!user) return res.status(404).json({ error: "User not found" })

  const existing = await db.companyMember.findUnique({ where: { companyId_userId: { companyId: 1, userId: user.clerkId } } })
  if (existing) return res.status(409).json({ error: "User is already a member" })

  const member = await db.companyMember.create({
    data: { companyId: 1, userId: user.clerkId, role: role === "ADMIN" ? "ADMIN" : "EMPLOYER" },
    include: { user: { select: { email: true, firstName: true, lastName: true, name: true } } },
  })
  return res.status(201).json({ success: true, member })
})

// PATCH /api/admin/employers/:id
router.patch("/employers/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const memberId = parseInt(req.params.id)
  const { role } = req.body
  if (!role || !["ADMIN", "EMPLOYER"].includes(role)) return res.status(400).json({ error: "Invalid role" })

  const member = await db.companyMember.findUnique({ where: { id: memberId } })
  if (!member) return res.status(404).json({ error: "Member not found" })

  const updated = await db.companyMember.update({
    where: { id: memberId }, data: { role },
    include: { user: { select: { email: true, firstName: true, lastName: true, name: true } } },
  })
  return res.json({ success: true, member: updated })
})

// DELETE /api/admin/employers/:id
router.delete("/employers/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const memberId = parseInt(req.params.id)
  const member = await db.companyMember.findUnique({ where: { id: memberId } })
  if (!member) return res.status(404).json({ error: "Member not found" })

  if (member.role === "ADMIN") {
    const adminCount = await db.companyMember.count({ where: { companyId: 1, role: "ADMIN" } })
    if (adminCount <= 1) return res.status(400).json({ error: "Cannot remove the last admin" })
  }

  await db.companyMember.delete({ where: { id: memberId } })
  return res.json({ success: true })
})

// GET /api/admin/company
router.get("/company", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const company = await db.company.findUnique({ where: { slug: "loft-community" } })
  if (!company) return res.status(404).json({ error: "Company not found" })
  return res.json(company)
})

// PATCH /api/admin/company
router.patch("/company", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const body = req.body
  const { name, description, logo, website, contactEmail } = body
  const company = await db.company.update({
    where: { slug: "loft-community" },
    data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }), ...(logo !== undefined && { logo }), ...(website !== undefined && { website }), ...(contactEmail !== undefined && { contactEmail }) },
  })
  return res.json({ success: true, company })
})

// GET /api/admin/jobs
router.get("/jobs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const status = req.query.status as string
  const whereClause = status ? { status: status as any } : {}

  const jobs = await db.job.findMany({
    where: whereClause,
    include: { employer: { select: { companyName: true, contactEmail: true, user: { select: { email: true } } } } },
    orderBy: { createdAt: "desc" }, take: 100,
  })

  return res.json(jobs.map(job => ({
    id: job.id, title: job.title, status: job.status, isActive: job.isActive,
    createdAt: job.createdAt, publishedAt: job.publishedAt, applicationsCount: job.applicationsCount,
    company: { name: job.employer?.companyName, email: job.employer?.user?.email },
  })))
})

// PATCH /api/admin/jobs - Moderate job
router.patch("/jobs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const { jobId, action, reason } = req.body
  if (!jobId || !action) return res.status(400).json({ error: "Missing required fields" })

  const updateData: any = {}
  switch (action) {
    case "approve": updateData.status = "PUBLISHED"; updateData.isActive = true; break
    case "reject": updateData.status = "CLOSED"; updateData.isActive = false; break
    case "flag": updateData.isActive = false; break
    default: return res.status(400).json({ error: "Invalid action" })
  }

  const job = await db.job.update({ where: { id: jobId }, data: updateData })

  const message = action === "approve"
    ? "Your job has been approved and published"
    : action === "reject"
    ? `Your job has been rejected${reason ? `: ${reason}` : ""}`
    : "Your job has been flagged and requires review"

  await db.notification.create({
    data: { userId: job.employerId, title: `Job ${action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Flagged"}`, message, type: "JOB_RECOMMENDED" },
  })

  return res.json({ success: true, job })
})

export default router

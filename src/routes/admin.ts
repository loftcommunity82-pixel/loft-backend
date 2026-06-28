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

  const [totalUsers, totalSeekers, totalEmployers, activeJobs, totalApplications, hiredThisMonth, pendingJobs, flaggedJobs, applicationsThisWeek, pendingApps, reviewingApps, shortlistedApps, interviewApps, offeredApps, rejectedApps] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { isApplicant: true } }),
    db.user.count({ where: { isEmployer: true } }),
    db.job.count({ where: { status: "PUBLISHED", isActive: true } }),
    db.jobApplication.count(),
    db.jobApplication.count({ where: { status: "HIRED" } }),
    db.job.count({ where: { status: "DRAFT" } }),
    db.job.count({ where: { isActive: false, status: "PUBLISHED" } }),
    db.jobApplication.count({ where: { appliedAt: { gte: weekAgo } } }),
    db.jobApplication.count({ where: { status: "PENDING" } }),
    db.jobApplication.count({ where: { status: "REVIEWING" } }),
    db.jobApplication.count({ where: { status: "SHORTLISTED" } }),
    db.jobApplication.count({ where: { status: "INTERVIEW" } }),
    db.jobApplication.count({ where: { status: "OFFERED" } }),
    db.jobApplication.count({ where: { status: "REJECTED" } }),
  ])

  const hireRate = totalApplications > 0 ? Math.round((hiredThisMonth / totalApplications) * 100) : 0

  return res.json({ totalUsers, totalSeekers, totalEmployers, activeJobs, totalApplications, applicationsThisWeek, hiredThisMonth, pendingJobs, flaggedJobs, hireRate, pendingApps, reviewingApps, shortlistedApps, interviewApps, offeredApps, rejectedApps, updatedAt: new Date().toISOString() })
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

// GET /api/admin/applications - List all applications across all jobs
router.get("/applications", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const status = req.query.status as string
  const search = req.query.search as string
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50))

  const where: Record<string, unknown> = {}
  if (status) where.status = status

  // Status breakdown for header
  const [
    total,
    pendingCount,
    reviewingCount,
    shortlistedCount,
    interviewCount,
    offeredCount,
    hiredCount,
    rejectedCount,
  ] = await Promise.all([
    db.jobApplication.count({ where }),
    db.jobApplication.count({ where: { status: "PENDING" } }),
    db.jobApplication.count({ where: { status: "REVIEWING" } }),
    db.jobApplication.count({ where: { status: "SHORTLISTED" } }),
    db.jobApplication.count({ where: { status: "INTERVIEW" } }),
    db.jobApplication.count({ where: { status: "OFFERED" } }),
    db.jobApplication.count({ where: { status: "HIRED" } }),
    db.jobApplication.count({ where: { status: "REJECTED" } }),
  ])

  const applications = await db.jobApplication.findMany({
    where,
    include: {
      job: {
        select: {
          id: true, title: true, slug: true, location: true, city: true,
          jobType: true, experienceLevel: true, workMode: true,
          employer: { select: { companyName: true, companyLogo: true, contactEmail: true } },
        },
      },
      user: {
        select: {
          id: true, clerkId: true, firstName: true, lastName: true,
          email: true, profileImage: true, phone: true,
          profile: { select: { jobTitle: true, experienceYears: true, skills: true } },
        },
      },
    },
    orderBy: { appliedAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  })

  return res.json({
    applications: applications.map(app => ({
      id: app.id, status: app.status, coverLetter: app.coverLetter,
      appliedAt: app.appliedAt, reviewedAt: app.reviewedAt,
      interviewAt: app.interviewAt, employerNotes: app.employerNotes,
      isShortlisted: app.isShortlisted,
      job: app.job,
      candidate: app.user,
    })),
    stats: {
      total, pendingCount, reviewingCount, shortlistedCount,
      interviewCount, offeredCount, hiredCount, rejectedCount,
    },
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
})

// GET /api/admin/applications/:id - Full application detail
router.get("/applications/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdmin(req, res))) return

  const applicationId = parseInt(req.params.id)
  const application = await db.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      job: {
        include: {
          employer: { select: { companyName: true, companyLogo: true, city: true, industry: true, contactEmail: true } },
          requiredSkillsRelation: { include: { skill: true } },
        },
      },
      user: {
        select: {
          id: true, clerkId: true, firstName: true, lastName: true,
          email: true, profileImage: true, name: true, phone: true,
          profile: { select: { jobTitle: true, summary: true, experienceYears: true, skills: true } },
        },
      },
      interview: true,
    },
  })

  if (!application) return res.status(404).json({ error: "Application not found" })

  return res.json({
    id: application.id, status: application.status, coverLetter: application.coverLetter,
    resumeUrl: application.resumeUrl, appliedAt: application.appliedAt,
    reviewedAt: application.reviewedAt, interviewAt: application.interviewAt,
    rejectedAt: application.rejectedAt, acceptedAt: application.acceptedAt,
    employerNotes: application.employerNotes, isShortlisted: application.isShortlisted,
    englishTestRequired: application.englishTestRequired,
    englishTestScore: application.englishTestScore,
    passedScreening: application.passedScreening,
    job: {
      id: application.job.id, title: application.job.title, slug: application.job.slug,
      location: application.job.location, city: application.job.city,
      jobType: application.job.jobType, experienceLevel: application.job.experienceLevel,
      workMode: application.job.workMode,
      salaryMin: application.job.salaryMin, salaryMax: application.job.salaryMax,
      salaryCurrency: application.job.salaryCurrency,
      skills: application.job.requiredSkillsRelation.map(rs => rs.skill.name),
      company: application.job.employer,
    },
    candidate: application.user,
    interview: application.interview,
  })
})

export default router

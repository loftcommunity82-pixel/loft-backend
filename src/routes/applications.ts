import { Router, Response } from "express"
import { db } from "../lib/db"
import { requireAuth } from "../middleware/auth"
import { sendEmail, emailTemplates, shouldSendEmail } from "../lib/email"
import { createLogger } from "../lib/logger"
import type { AuthenticatedRequest } from "../types"

const router = Router()
const log = createLogger("applications")

// GET /api/applications - List applications
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const jobIdParam = req.query.jobId as string
    const statusParam = req.query.status as string

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const where: Record<string, unknown> = {}
    if (statusParam) where.status = statusParam
    if (jobIdParam) {
      where.jobId = parseInt(jobIdParam)
    } else if (user.isEmployer) {
      where.job = { employerId: user.clerkId }
    } else {
      where.userId = user.clerkId
    }

    const applications = await db.jobApplication.findMany({
      where,
      include: {
        job: { include: { employer: { select: { companyName: true, companyLogo: true, city: true } } } },
        user: { select: { id: true, firstName: true, lastName: true, email: true, profileImage: true } },
      },
      orderBy: { appliedAt: "desc" },
    })

    return res.json(applications.map(app => ({
      id: app.id, jobId: app.jobId, userId: app.userId, status: app.status,
      coverLetter: app.coverLetter, appliedAt: app.appliedAt, reviewedAt: app.reviewedAt,
      interviewAt: app.interviewAt, englishTestScore: app.englishTestScore,
      englishTestRequired: app.englishTestRequired, employerNotes: app.employerNotes,
      isShortlisted: app.isShortlisted,
      job: { id: app.job.id, title: app.job.title, slug: app.job.slug, location: app.job.location, city: app.job.city, jobType: app.job.jobType, company: app.job.employer },
      candidate: { id: app.user.id, firstName: app.user.firstName, lastName: app.user.lastName, email: app.user.email, profileImage: app.user.profileImage },
    })))
  } catch (error) {
    log.error("List applications error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/applications/:id - Get single application
router.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const applicationId = parseInt(req.params.id)
    const application = await db.jobApplication.findUnique({
      where: { id: applicationId },
      include: {
        job: { include: { employer: { select: { companyName: true, companyLogo: true, city: true, industry: true } }, requiredSkillsRelation: { include: { skill: true } } } },
        user: { select: { id: true, clerkId: true, firstName: true, lastName: true, email: true, profileImage: true, name: true } },
        interview: true,
      },
    })
    if (!application) return res.status(404).json({ error: "Application not found" })

    return res.json({
      id: application.id, jobId: application.jobId, userId: application.userId,
      status: application.status, coverLetter: application.coverLetter, resumeUrl: application.resumeUrl,
      appliedAt: application.appliedAt, reviewedAt: application.reviewedAt,
      interviewAt: application.interviewAt, rejectedAt: application.rejectedAt,
      acceptedAt: application.acceptedAt, employerNotes: application.employerNotes,
      englishTestRequired: application.englishTestRequired, englishTestScore: application.englishTestScore,
      passedScreening: application.passedScreening,
      job: { id: application.job.id, title: application.job.title, slug: application.job.slug, location: application.job.location, city: application.job.city, jobType: application.job.jobType, experienceLevel: application.job.experienceLevel, workMode: application.job.workMode, salaryMin: application.job.salaryMin, salaryMax: application.job.salaryMax, salaryCurrency: application.job.salaryCurrency, skills: application.job.requiredSkillsRelation.map(rs => rs.skill.name), company: application.job.employer },
      candidate: application.user,
      interview: application.interview,
    })
  } catch (error) {
    log.error("Get application error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/applications/:id/interviews - Schedule interview
router.post("/:id/interviews", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const applicationId = parseInt(req.params.id)
    if (isNaN(applicationId)) return res.status(400).json({ error: "Invalid application ID" })

    const application = await db.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true } })
    if (!application) return res.status(404).json({ error: "Application not found" })

    const user = await db.user.findUnique({ where: { email: userEmail }, include: { companyMemberships: { take: 1 } } })
    if (!user) return res.status(403).json({ error: "Not authorized" })

    const isOwner = application.job.employerId === user.clerkId
    const isCompanyMember = user.companyMemberships.length > 0
    if (!isOwner && !isCompanyMember) return res.status(403).json({ error: "Not authorized" })

    const existingInterview = await db.interview.findUnique({ where: { applicationId } })
    if (existingInterview) return res.status(409).json({ error: "Interview already scheduled for this application" })

    const { scheduledAt, duration, type, meetingLink, location } = req.body
    if (!scheduledAt || !type) return res.status(400).json({ error: "scheduledAt and type are required" })

    const interview = await db.interview.create({
      data: { applicationId, scheduledAt: new Date(scheduledAt), duration: duration || 60, type, meetingLink: meetingLink || null, location: location || null },
    })

    await db.jobApplication.update({ where: { id: applicationId }, data: { status: "INTERVIEW", interviewAt: new Date(scheduledAt) } })
    await db.notification.create({
      data: { userId: application.userId, title: "Interview Scheduled", message: `Your interview has been scheduled for ${new Date(scheduledAt).toLocaleString()}`, type: "INTERVIEW_SCHEDULED", link: `/applications/${applicationId}` },
    })

    return res.json({ success: true, interview, applicationStatus: "INTERVIEW" })
  } catch (error) {
    log.error("Schedule interview error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// PATCH /api/applications/:id/notes - Update notes
router.patch("/:id/notes", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const applicationId = parseInt(req.params.id)
    const { notes } = req.body

    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail }, include: { companyMemberships: { take: 1 } } })
    if (!user) return res.status(403).json({ error: "Not authorized" })

    const application = await db.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true } })
    if (!application) return res.status(404).json({ error: "Application not found" })

    const isOwner = application.job.employerId === user.clerkId
    const isCompanyMember = user.companyMemberships.length > 0
    if (!isOwner && !isCompanyMember) return res.status(403).json({ error: "Not authorized" })

    const updated = await db.jobApplication.update({ where: { id: applicationId }, data: { employerNotes: notes } })
    return res.json({ success: true, employerNotes: updated.employerNotes })
  } catch (error) {
    log.error("Update notes error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// PATCH /api/applications/:id/shortlist - Shortlist toggle
router.patch("/:id/shortlist", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const applicationId = parseInt(req.params.id)
    const { isShortlisted } = req.body

    const application = await db.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true } })
    if (!application) return res.status(404).json({ error: "Application not found" })

    const user = await db.user.findUnique({ where: { email: userEmail }, include: { companyMemberships: { take: 1 } } })
    if (!user) return res.status(403).json({ error: "Not authorized" })

    const isOwner = application.job.employerId === user.clerkId
    const isCompanyMember = user.companyMemberships.length > 0
    if (!isOwner && !isCompanyMember) return res.status(403).json({ error: "Not authorized" })

    const updated = await db.jobApplication.update({ where: { id: applicationId }, data: { isShortlisted } })
    return res.json({ success: true, isShortlisted: updated.isShortlisted })
  } catch (error) {
    log.error("Shortlist error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// PATCH /api/applications/:id/status - Update status
router.patch("/:id/status", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const applicationId = parseInt(req.params.id)
    const { status, notes } = req.body

    const validStatuses = ["PENDING", "REVIEWING", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"]
    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" })

    const application = await db.jobApplication.findUnique({
      where: { id: applicationId },
      include: { user: true, job: { include: { employer: { select: { companyName: true, contactEmail: true } } } } },
    })
    if (!application) return res.status(404).json({ error: "Application not found" })

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (application.job.employerId !== user?.clerkId) return res.status(403).json({ error: "Not authorized" })

    const updated = await db.jobApplication.update({
      where: { id: applicationId },
      data: {
        status,
        ...(notes ? { employerNotes: notes } : {}),
        reviewedAt: status === "REVIEWING" || status === "SHORTLISTED" ? new Date() : application.reviewedAt,
        interviewAt: status === "INTERVIEW" ? new Date() : application.interviewAt,
        acceptedAt: status === "HIRED" ? new Date() : application.acceptedAt,
        rejectedAt: status === "REJECTED" ? new Date() : application.rejectedAt,
      },
    })

    const notificationType = status === "REJECTED" ? "APPLICATION_REJECTED" : "APPLICATION_SHORTLISTED"
    await db.notification.create({
      data: { userId: application.userId, title: "Application Status Update", message: `Your application for ${application.job.title} is now ${status.toLowerCase()}`, type: notificationType, link: `/dashboard/applications/${application.id}` },
    })

    const companyName = application.job.employer?.companyName || "the company"
    const shouldNotify = await shouldSendEmail(application.userId, "applicationUpdates")
    if (shouldNotify) {
      await sendEmail(emailTemplates.statusUpdate(application.job.title, companyName, status.toLowerCase(), application.user.email))
    }

    return res.json({ success: true, application: { id: updated.id, status: updated.status, reviewedAt: updated.reviewedAt, interviewAt: updated.interviewAt } })
  } catch (error) {
    log.error("Update status error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

export default router

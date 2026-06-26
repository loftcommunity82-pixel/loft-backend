import { Router, Response } from "express"
import { db } from "../lib/db"
import { requireAuth } from "../middleware/auth"
import { createLogger } from "../lib/logger"
import type { AuthenticatedRequest } from "../types"

const router = Router()
const log = createLogger("users")

// GET /api/users/profile
router.get("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { profile: { include: { skillsRelation: { include: { skill: true } } } }, resume: true },
    })
    if (!user) return res.status(404).json({ error: "User not found" })
    return res.json(user)
  } catch (error) {
    log.error("Get profile error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// PATCH /api/users/profile
router.patch("/profile", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const body = req.body
    const { firstName, lastName, phone, dateOfBirth, address, city, country, nationality, jobTitle, summary, experienceYears, remoteWork, relocate, expectedSalary, availability, englishTestScore, englishTestDate, englishTestLevel, skills } = body

    const user = await db.user.update({
      where: { email: userEmail },
      data: {
        firstName, lastName,
        phone: phone || undefined,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        address: address || undefined, city: city || undefined, country: country || undefined,
        nationality: nationality || undefined,
        englishTestScore: englishTestScore !== undefined ? englishTestScore : undefined,
        englishTestDate: englishTestDate ? new Date(englishTestDate) : undefined,
        englishTestLevel: englishTestLevel || undefined,
      },
    })

    const profile = await db.userProfile.upsert({
      where: { userId: user.clerkId },
      update: {
        jobTitle: jobTitle || undefined, summary: summary || undefined,
        experienceYears: experienceYears !== undefined ? experienceYears : undefined,
        remoteWork: remoteWork !== undefined ? remoteWork : undefined,
        relocate: relocate !== undefined ? relocate : undefined,
        expectedSalary: expectedSalary ? parseFloat(expectedSalary) : undefined,
        availability: availability || undefined, skills: skills || undefined,
      },
      create: {
        userId: user.clerkId, jobTitle: jobTitle || null, summary: summary || null,
        experienceYears: experienceYears || null, remoteWork: remoteWork || false,
        relocate: relocate || false, expectedSalary: expectedSalary ? parseFloat(expectedSalary) : null,
        availability: availability || null, skills: skills || [],
      },
    })

    return res.json({ user, profile })
  } catch (error) {
    log.error("Update profile error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/users/skills
router.get("/skills", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail }, include: { profile: true } })
    if (!user?.profile) return res.json([])

    const skills = await db.userSkill.findMany({
      where: { userId: user.profile.id },
      include: { skill: true },
    })
    return res.json(skills)
  } catch (error) {
    log.error("Get skills error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/users/skills - Add skill
router.post("/skills", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const { skillName, level } = req.body
    const user = await db.user.findUnique({ where: { email: userEmail }, include: { profile: true } })
    if (!user?.profile) return res.status(404).json({ error: "Profile not found" })

    let skill = await db.skill.findUnique({ where: { name: skillName } })
    if (!skill) skill = await db.skill.create({ data: { name: skillName, isCustom: true } })

    const existing = await db.userSkill.findFirst({ where: { userId: user.profile.id, skillId: skill.id } })
    if (existing) return res.status(400).json({ error: "Skill already added" })

    const userSkill = await db.userSkill.create({
      data: { userId: user.profile.id, skillId: skill.id, level: level || "INTERMEDIATE" },
      include: { skill: true },
    })
    return res.json(userSkill)
  } catch (error) {
    log.error("Add skill error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// DELETE /api/users/skills?skillId=
router.delete("/skills", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const skillId = req.query.skillId as string
    if (!skillId) return res.status(400).json({ error: "skillId required" })

    const user = await db.user.findUnique({ where: { email: userEmail }, include: { profile: true } })
    if (!user?.profile) return res.status(404).json({ error: "Profile not found" })

    await db.userSkill.delete({
      where: { userId_skillId: { userId: user.profile.id, skillId: parseInt(skillId) } },
    })
    return res.json({ success: true })
  } catch (error) {
    log.error("Delete skill error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/users/role - Update role
router.post("/role", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const { role } = req.body
    if (!role) return res.status(400).json({ error: "Role required" })

    const user = await db.user.update({
      where: { email: userEmail },
      data: { isEmployer: role === "EMPLOYER", isApplicant: role === "JOB_SEEKER" },
    })
    return res.json({ success: true, role: user.isEmployer ? "EMPLOYER" : "JOB_SEEKER" })
  } catch (error) {
    log.error("Update role error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/users/resume - Upload/resume
router.post("/resume", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const { fileUrl, fileName, fileSize, fileType } = req.body
    if (!fileUrl) return res.status(400).json({ error: "fileUrl is required" })

    const resume = await db.resume.upsert({
      where: { userId: user.clerkId },
      update: { fileName: fileName || "Resume.pdf", fileUrl, fileType: fileType || "pdf", fileSize: fileSize || 0, isUploaded: true },
      create: { userId: user.clerkId, fileName: fileName || "Resume.pdf", fileUrl, fileType: fileType || "pdf", fileSize: fileSize || 0, isUploaded: true },
    })
    return res.json({ success: true, resume: { id: resume.id, fileName: resume.fileName, fileUrl: resume.fileUrl } })
  } catch (error) {
    log.error("Upload resume error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/users/saved-jobs
router.get("/saved-jobs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const savedJobs = await db.savedJob.findMany({
      where: { userId: user.clerkId },
      include: { job: { include: { employer: { select: { companyName: true, companyLogo: true } } } } },
      orderBy: { createdAt: "desc" },
    })
    return res.json(savedJobs.map(sj => ({
      id: sj.id, jobId: sj.jobId, savedAt: sj.createdAt,
      job: { id: sj.job.id, title: sj.job.title, slug: sj.job.slug, location: sj.job.location, city: sj.job.city, remoteWork: sj.job.remoteWork, jobType: sj.job.jobType, company: sj.job.employer },
    })))
  } catch (error) {
    log.error("Get saved jobs error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/users/saved-jobs
router.post("/saved-jobs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const { jobId } = req.body
    if (!jobId) return res.status(400).json({ error: "jobId required" })

    const existing = await db.savedJob.findFirst({ where: { userId: user.clerkId, jobId } })
    if (existing) return res.status(400).json({ error: "Job already saved" })

    const savedCount = await db.savedJob.count({ where: { userId: user.clerkId } })
    if (savedCount >= 100) return res.status(400).json({ error: "Maximum 100 saved jobs reached" })

    const savedJob = await db.savedJob.create({ data: { userId: user.clerkId, jobId } })
    return res.json({ success: true, savedJob })
  } catch (error) {
    log.error("Save job error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// DELETE /api/users/saved-jobs?jobId=
router.delete("/saved-jobs", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const jobId = req.query.jobId as string
    if (!jobId) return res.status(400).json({ error: "jobId required" })

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    await db.savedJob.delete({
      where: { userId_jobId: { userId: user.clerkId, jobId: parseInt(jobId) } },
    })
    return res.json({ success: true })
  } catch (error) {
    log.error("Unsave job error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/users/notifications - Notification preferences
router.get("/notifications", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    let prefs = await db.notificationPreference.findUnique({ where: { userId: user.clerkId } })
    if (!prefs) prefs = await db.notificationPreference.create({ data: { userId: user.clerkId } })
    return res.json(prefs)
  } catch (error) {
    log.error("Get notification prefs error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// PATCH /api/users/notifications - Update notification preferences
router.patch("/notifications", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const body = req.body
    const prefs = await db.notificationPreference.upsert({
      where: { userId: user.clerkId },
      update: {
        applicationUpdates: body.applicationUpdates !== undefined ? body.applicationUpdates : undefined,
        newMessages: body.newMessages !== undefined ? body.newMessages : undefined,
        jobAlerts: body.jobAlerts !== undefined ? body.jobAlerts : undefined,
        marketing: body.marketing !== undefined ? body.marketing : undefined,
      },
      create: { userId: user.clerkId, applicationUpdates: body.applicationUpdates ?? true, newMessages: body.newMessages ?? true, jobAlerts: body.jobAlerts ?? true, marketing: body.marketing ?? false },
    })
    return res.json(prefs)
  } catch (error) {
    log.error("Update notification prefs error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

export default router

import { Router, Request, Response } from "express"
import { db } from "../lib/db"
import { requireAuth, optionalAuth } from "../middleware/auth"
import { getAllRemoteJobs, findRemoteJobBySlug, findRemoteJobById } from "../lib/remote-jobs"
import { createLogger } from "../lib/logger"
import type { AuthenticatedRequest } from "../types"

const router = Router()
const log = createLogger("jobs")

// GET /api/jobs - Search and list jobs
router.get("/", async (req: Request, res: Response) => {
  const search = (req.query.search as string) || ""
  const location = (req.query.location as string) || ""
  const experience = (req.query.experience as string) || ""
  const jobType = (req.query.jobType as string) || ""
  const workMode = (req.query.workMode as string) || ""
  const sort = (req.query.sort as string) || "recent"
  const page = parseInt(req.query.page as string) || 1
  const limit = parseInt(req.query.limit as string) || 12

  function getOrderBy(): any {
    switch (sort) {
      case "salary_high": return { salaryMax: { sort: "desc" as const, nulls: "last" as const } }
      case "salary_low": return { salaryMax: { sort: "asc" as const, nulls: "last" as const } }
      default: return { publishedAt: "desc" as const }
    }
  }

  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    await db.job.updateMany({
      where: {
        isActive: true,
        publishedAt: { lte: thirtyDaysAgo },
        status: "PUBLISHED",
      },
      data: {
        isActive: false,
        status: "CLOSED",
        closedAt: new Date(),
      },
    })

    const where: any = { status: "PUBLISHED", isActive: true }
    const filters: any[] = []

    if (search) {
      filters.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      })
    }

    if (location) {
      filters.push({
        OR: [
          { city: { contains: location, mode: "insensitive" } },
          { location: { contains: location, mode: "insensitive" } },
          ...(location.toLowerCase() === "remote" ? [{ remoteWork: true }] : []),
        ],
      })
    }

    filters.push({
      OR: [
        { deadline: null },
        { deadline: { gte: new Date() } },
      ],
    })
    if (experience) filters.push({ experienceLevel: experience })
    if (jobType) filters.push({ jobType })
    if (workMode) filters.push({ workMode })
    if (filters.length > 0) where.AND = filters

    const [jobs, total] = await Promise.all([
      db.job.findMany({
        where,
        include: {
          employer: {
            select: { companyName: true, companyLogo: true, city: true },
          },
          requiredSkillsRelation: { include: { skill: true } },
        },
        orderBy: getOrderBy(),
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.job.count({ where }),
    ])

    const remoteJobs = (await getAllRemoteJobs()).filter((j) => {
      if (search) {
        const q = search.toLowerCase()
        if (!j.title.toLowerCase().includes(q) && !j.description.toLowerCase().includes(q)) return false
      }
      if (location && !j.location?.toLowerCase().includes(location.toLowerCase())) return false
      return true
    })

    const mappedJobs = jobs.map((job) => ({
      id: job.id,
      title: job.title,
      slug: job.slug,
      description: job.description,
      jobType: job.jobType,
      experienceLevel: job.experienceLevel,
      workMode: job.workMode,
      location: job.location,
      city: job.city,
      remoteWork: job.remoteWork,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      viewsCount: job.viewsCount,
      applicationsCount: job.applicationsCount,
      publishedAt: job.publishedAt,
      company: job.employer,
      skills: job.requiredSkillsRelation.map((rs) => rs.skill.name),
      source: "local",
    }))

    return res.json({
      jobs: [...mappedJobs, ...remoteJobs],
      total: total + remoteJobs.length,
      page,
      totalPages: Math.ceil((total + remoteJobs.length) / limit),
    })
  } catch {
    // Fallback to remote jobs only on error
    const remoteJobs = await getAllRemoteJobs()
    return res.json({
      jobs: remoteJobs,
      total: remoteJobs.length,
      page,
      totalPages: Math.ceil(remoteJobs.length / limit),
    })
  }
})

// POST /api/jobs - Create job (employer only)
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email

    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: {
        employerProfile: true,
        companyMemberships: { take: 1 },
      },
    })

    if (!user?.employerProfile) {
      return res.status(403).json({ error: "Company profile required" })
    }

    const {
      title, description, requirements,
      jobType, experienceLevel, workMode,
      location, city, salaryMin, salaryMax,
      skills, deadline, status: requestedStatus,
    } = req.body

    if (!title || !description || !jobType || !experienceLevel || !workMode) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now()
    const companyId = user.companyMemberships[0]?.companyId || 1
    const isPublished = requestedStatus === "PUBLISHED"

    const job = await db.job.create({
      data: {
        title,
        slug,
        description,
        requirements,
        jobType,
        experienceLevel,
        workMode,
        location,
        city,
        salaryMin: salaryMin ? parseInt(salaryMin) : null,
        salaryMax: salaryMax ? parseInt(salaryMax) : null,
        companyId,
        status: isPublished ? "PUBLISHED" : "DRAFT",
        isActive: isPublished,
        publishedAt: isPublished ? new Date() : null,
        deadline: deadline ? new Date(deadline) : null,
        employerId: user.clerkId,
      },
    })

    if (skills && skills.length > 0) {
      for (const skillName of skills) {
        let skill = await db.skill.findUnique({ where: { name: skillName } })
        if (!skill) {
          skill = await db.skill.create({ data: { name: skillName, isCustom: true } })
        }
        await db.jobRequiredSkill.create({
          data: { jobId: job.id, skillId: skill.id, isRequired: true },
        })
      }
    }

    return res.status(201).json({
      success: true,
      job: { ...job, skills: skills || [] },
    })
  } catch (error) {
    log.error("Create job error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/jobs/remote - Fetch remote jobs (must be before :slug)
router.get("/remote", async (req: Request, res: Response) => {
  const count = (req.query.count as string) || "20"
  const geo = (req.query.geo as string) || ""
  const industry = (req.query.industry as string) || ""
  const tag = (req.query.tag as string) || ""

  const CACHE_KEY = "remote-jobs"
  const CACHE_TTL_MS = 15 * 60 * 1000
  const JOBICY_URL = "https://jobicy.com/api/v2/remote-jobs"

  async function readCache(): Promise<{ data: any; timestamp: number } | null> {
    try {
      const entry = await db.cacheEntry.findUnique({ where: { key: CACHE_KEY } })
      if (!entry) return null
      return { data: entry.data, timestamp: entry.createdAt.getTime() }
    } catch { return null }
  }

  async function writeCache(data: any) {
    try {
      await db.cacheEntry.upsert({
        where: { key: CACHE_KEY },
        update: { data: data as any, createdAt: new Date(), expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
        create: { key: CACHE_KEY, data: data as any, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
      })
    } catch { /* noop */ }
  }

  const cached = await readCache()
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    let jobs = cached.data as any[]
    if (tag) jobs = jobs.filter((j: any) => (j.jobTitle + " " + j.jobDescription).toLowerCase().includes(tag.toLowerCase()))
    if (geo) jobs = jobs.filter((j: any) => j.jobGeo?.toLowerCase().includes(geo.toLowerCase()))
    if (industry) jobs = jobs.filter((j: any) => j.jobIndustry?.toLowerCase().includes(industry.toLowerCase()))
    return res.json({ jobs: jobs.slice(0, parseInt(count)), source: "cache", total: jobs.length })
  }

  try {
    const url = `${JOBICY_URL}?count=${count}${geo ? `&geo=${geo}` : ""}${industry ? `&industry=${industry}` : ""}${tag ? `&tag=${tag}` : ""}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Jobicy returned ${response.status}`)
    const data: any = await response.json()
    const jobs = data.jobs || data || []
    await writeCache(jobs)
    return res.json({ jobs, source: "live", total: jobs.length })
  } catch {
    const staleCache = await readCache()
    if (staleCache) {
      return res.json({ jobs: staleCache.data, source: "cache", cachedAt: new Date(staleCache.timestamp).toISOString(), total: (staleCache.data as any[]).length })
    }
    return res.json({ jobs: [], source: "none", total: 0 })
  }
})

// GET /api/jobs/:slug - Get single job
router.get("/:slug", async (req: Request, res: Response) => {
  const rawSlug = req.params.slug
  const jobId = parseInt(rawSlug)
  const isNumeric = !isNaN(jobId)

  const job = await db.job.findFirst({
    where: isNumeric ? { id: jobId } : { slug: rawSlug },
    include: {
      employer: {
        select: { companyName: true, companyLogo: true, companySize: true, industry: true, description: true, contactEmail: true, city: true, country: true, linkedIn: true, twitter: true, hiringMode: true },
      },
      requiredSkillsRelation: { include: { skill: true } },
      category: true,
    },
  })

  if (!job) {
    const remoteJob = await findRemoteJobBySlug(rawSlug)
    if (remoteJob) {
      return res.json({ ...remoteJob, requiredSkills: remoteJob.skills, source: "jobicy" })
    }
    if (!isNaN(jobId)) {
      const remoteById = await findRemoteJobById(jobId)
      if (remoteById) {
        return res.json({ ...remoteById, requiredSkills: remoteById.skills, source: "jobicy" })
      }
    }
    return res.status(404).json({ error: "Job not found" })
  }

  return res.json({
    id: job.id,
    title: job.title,
    slug: job.slug,
    description: job.description,
    requirements: job.requirements,
    benefits: job.benefits,
    jobType: job.jobType,
    experienceLevel: job.experienceLevel,
    workMode: job.workMode,
    location: job.location,
    city: job.city,
    country: job.country,
    remoteWork: job.remoteWork,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    isSalaryVisible: job.isSalaryVisible,
    requiredSkills: job.requiredSkillsRelation.map((rs) => rs.skill.name),
    preferredSkills: job.preferredSkills,
    status: job.status,
    isFeatured: job.isFeatured,
    isActive: job.isActive,
    viewsCount: job.viewsCount,
    applicationsCount: job.applicationsCount,
    employerId: job.employerId,
    category: job.category,
    deadline: job.deadline,
    publishedAt: job.publishedAt,
    createdAt: job.createdAt,
    company: job.employer,
    source: "local",
  })
})

// PATCH /api/jobs/:slug - Update job
router.patch("/:slug", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { employerProfile: true, companyMemberships: { take: 1 } },
    })

    if (!user?.employerProfile) {
      return res.status(403).json({ error: "Company profile required" })
    }

    const rawSlug = req.params.slug
    const jobId = parseInt(rawSlug)
    const job = await db.job.findFirst({
      where: isNaN(jobId) ? { slug: rawSlug } : { id: jobId },
    })

    if (!job) return res.status(404).json({ error: "Job not found" })

    const isOwner = job.employerId === user.clerkId
    const isCompanyMember = user.companyMemberships?.length > 0
    if (!isOwner && !isCompanyMember) {
      return res.status(403).json({ error: "Not authorized" })
    }

    const { title, description, requirements, benefits, jobType, experienceLevel, workMode, location, city, salaryMin, salaryMax, status, isFeatured, isActive, deadline, skills, preferredSkills } = req.body

    const updateData: Record<string, unknown> = {}
    if (title !== undefined) updateData.title = title
    if (description !== undefined) updateData.description = description
    if (requirements !== undefined) updateData.requirements = requirements
    if (benefits !== undefined) updateData.benefits = benefits
    if (jobType !== undefined) updateData.jobType = jobType
    if (experienceLevel !== undefined) updateData.experienceLevel = experienceLevel
    if (workMode !== undefined) updateData.workMode = workMode
    if (location !== undefined) updateData.location = location
    if (city !== undefined) updateData.city = city
    if (salaryMin !== undefined) updateData.salaryMin = salaryMin
    if (salaryMax !== undefined) updateData.salaryMax = salaryMax
    if (isFeatured !== undefined) updateData.isFeatured = isFeatured
    if (isActive !== undefined) updateData.isActive = isActive
    if (preferredSkills !== undefined) updateData.preferredSkills = preferredSkills

    if (status !== undefined) {
      updateData.status = status
      if (status === "PUBLISHED") { updateData.publishedAt = new Date(); updateData.isActive = true }
      if (status === "CLOSED") { updateData.closedAt = new Date(); updateData.isActive = false }
      if (status === "DRAFT") { updateData.isActive = false }
    }

    if (deadline !== undefined) {
      updateData.deadline = deadline ? new Date(deadline) : null
    }

    const updated = await db.job.update({
      where: { id: job.id },
      data: updateData,
    })

    if (skills && Array.isArray(skills)) {
      await db.jobRequiredSkill.deleteMany({ where: { jobId: job.id } })
      for (const skillName of skills) {
        let skill = await db.skill.findUnique({ where: { name: skillName } })
        if (!skill) {
          skill = await db.skill.create({ data: { name: skillName, isCustom: true } })
        }
        await db.jobRequiredSkill.create({
          data: { jobId: job.id, skillId: skill.id, isRequired: true },
        })
      }
    }

    return res.json({ success: true, job: updated })
  } catch (error) {
    log.error("Update job error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// DELETE /api/jobs/:slug - Delete job
router.delete("/:slug", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { employerProfile: true, companyMemberships: { take: 1 } },
    })

    if (!user?.employerProfile) {
      return res.status(403).json({ error: "Company profile required" })
    }

    const rawSlug = req.params.slug
    const jobId = parseInt(rawSlug)
    const job = await db.job.findFirst({
      where: isNaN(jobId) ? { slug: rawSlug } : { id: jobId },
    })

    if (!job) return res.status(404).json({ error: "Job not found" })

    const isOwner = job.employerId === user.clerkId
    const isCompanyMember = user.companyMemberships?.length > 0
    if (!isOwner && !isCompanyMember) {
      return res.status(403).json({ error: "Not authorized" })
    }

    await db.job.delete({ where: { id: job.id } })
    return res.json({ success: true })
  } catch (error) {
    log.error("Delete job error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/jobs/:slug/apply - Apply to a job
router.post("/:slug/apply", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const rawId = req.params.slug
    const jobIdNum = parseInt(rawId)
    const job = await db.job.findFirst({
      where: isNaN(jobIdNum) ? { slug: rawId } : { id: jobIdNum },
    })
    if (!job) return res.status(404).json({ error: "Job not found" })
    const jobId = job.id

    const existing = await db.jobApplication.findFirst({ where: { userId: user.clerkId, jobId } })
    if (existing) return res.status(400).json({ error: "Already applied to this job" })

    const { coverLetter, resumeUrl } = req.body
    if (coverLetter && coverLetter.length > 5000) return res.status(400).json({ error: "Cover letter too long (max 5000 characters)" })
    const application = await db.jobApplication.create({
      data: { userId: user.clerkId, jobId, coverLetter, resumeUrl: resumeUrl || null, status: "PENDING" },
      include: {
        job: { include: { employer: { select: { companyName: true, companyLogo: true, contactEmail: true } } } },
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    })

    await db.job.update({ where: { id: jobId }, data: { applicationsCount: { increment: 1 } } })
    await db.notification.create({
      data: { userId: job.employerId, title: "New Application", message: `New application for ${job.title}`, type: "APPLICATION_RECEIVED", data: { applicationId: application.id, jobId } },
    })

    return res.status(201).json({ success: true, application: { id: application.id, status: application.status, appliedAt: application.appliedAt } })
  } catch (error) {
    log.error("Apply error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/jobs/:slug/candidates - List candidates for a job
router.get("/:slug/candidates", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const sort = (req.query.sort as string) || "matchScore"
    const rawSlug = req.params.slug
    const jobIdNum = parseInt(rawSlug)

    const job = await db.job.findFirst({
      where: isNaN(jobIdNum) ? { slug: rawSlug } : { id: jobIdNum },
      include: { requiredSkillsRelation: { include: { skill: true } } },
    })
    if (!job) return res.status(404).json({ error: "Job not found" })

    const user = await db.user.findUnique({
      where: { email: userEmail },
      include: { companyMemberships: { take: 1 } },
    })
    if (!user) return res.status(403).json({ error: "Not authorized" })

    const isOwner = job.employerId === user.clerkId
    const isCompanyMember = user.companyMemberships.length > 0
    if (!isOwner && !isCompanyMember) return res.status(403).json({ error: "Not authorized" })

    const applications = await db.jobApplication.findMany({
      where: { jobId: job.id },
      include: { user: { include: { profile: { include: { skillsRelation: { include: { skill: true } } } } } } },
    })

    const jobSkillIds = (job.requiredSkillsRelation || []).map((rs: any) => rs.skillId)
    const candidates = applications.map((app: any) => {
      const userSkillIds = (app.user.profile?.skillsRelation || []).map((s: any) => s.skillId)
      const matchedSkills = userSkillIds.filter((id: number) => jobSkillIds.includes(id)).length
      const matchScore = jobSkillIds.length > 0 ? Math.round((matchedSkills / jobSkillIds.length) * 100) : 0
      return { id: app.id, status: app.status, appliedAt: app.appliedAt, coverLetter: app.coverLetter, matchScore, matchedSkills, totalRequired: jobSkillIds.length, candidate: { id: app.user.id, clerkId: app.user.clerkId, name: app.user.name, firstName: app.user.firstName, lastName: app.user.lastName, email: app.user.email, profileImage: app.user.profileImage, profile: app.user.profile } }
    })

    if (sort === "date") candidates.sort((a: any, b: any) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
    else candidates.sort((a: any, b: any) => b.matchScore - a.matchScore)

    return res.json({ job: { id: job.id, title: job.title, requiredSkills: job.requiredSkillsRelation.map((rs: any) => rs.skill.name) }, candidates, total: candidates.length })
  } catch (error) {
    log.error("Candidates error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// GET /api/jobs/:slug/metrics - Job metrics
router.get("/:slug/metrics", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const jobId = parseInt(req.params.slug)

    const job = await db.job.findUnique({
      where: { id: jobId },
      include: { requiredSkillsRelation: { include: { skill: true } } },
    })
    if (!job) return res.status(404).json({ error: "Job not found" })

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (job.employerId !== user?.clerkId) return res.status(403).json({ error: "Not authorized" })

    const apps = await db.jobApplication.findMany({
      where: { jobId },
      include: { user: { include: { profile: { include: { skillsRelation: { include: { skill: true } } } } } } },
    })

    const count = (s: string) => apps.filter(a => a.status === s).length
    const jobSkillIds = (job.requiredSkillsRelation || []).map(rs => rs.skillId)
    const scores = apps.map(app => {
      const userSkillIds = (app.user.profile?.skillsRelation || []).map(s => s.skillId)
      return jobSkillIds.length > 0 ? Math.round((userSkillIds.filter(id => jobSkillIds.includes(id)).length / jobSkillIds.length) * 100) : 0
    })
    const avgMatchScore = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0

    return res.json({
      jobId, totalApplications: apps.length, pendingApplications: count("PENDING"),
      reviewingApplications: count("REVIEWING"), shortlistedApplications: count("SHORTLISTED"),
      interviewingApplications: count("INTERVIEW"), offeredApplications: count("OFFERED"),
      hiredApplications: count("HIRED"), rejectedApplications: count("REJECTED"),
      conversionRate: apps.length > 0 ? Math.round((count("HIRED") / apps.length) * 100) : 0,
      avgMatchScore, totalCandidates: apps.length,
    })
  } catch (error) {
    log.error("Metrics error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/jobs/:slug/report - Report a job
router.post("/:slug/report", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const jobId = parseInt(req.params.slug)
    if (isNaN(jobId)) return res.status(400).json({ error: "Invalid job ID" })

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const { reason } = req.body
    if (!reason) return res.status(400).json({ error: "Reason is required" })

    await db.report.create({ data: { reporterId: user.clerkId, reportedType: "JOB", reportedId: jobId, reason } })
    return res.json({ success: true, message: "Report submitted. We will review it shortly." })
  } catch (error) {
    log.error("Report error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

export default router

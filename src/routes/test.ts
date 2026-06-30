import { Router, Request, Response } from "express"
import bcrypt from "bcryptjs"
import { db } from "../lib/db"

const router = Router()

// POST /api/test/setup - Seed test data for E2E tests
router.post("/setup", async (_req: Request, res: Response) => {
  try {
    const now = Date.now()

    // Create test applicant
    const applicant = await db.user.upsert({
      where: { email: "e2e-applicant@test.com" },
      update: {},
      create: {
        email: "e2e-applicant@test.com",
        clerkId: `e2e_applicant_${now}`,
        firstName: "E2E",
        lastName: "Applicant",
        hashedPassword: await bcrypt.hash("E2ETestPass123!", 10),
        isApplicant: true,
        isEmployer: false,
        isVerified: true,
        emailVerified: true,
      },
    })

    // Create test employer
    const employer = await db.user.upsert({
      where: { email: "e2e-employer@test.com" },
      update: {},
      create: {
        email: "e2e-employer@test.com",
        clerkId: `e2e_employer_${now}`,
        firstName: "E2E",
        lastName: "Employer",
        hashedPassword: await bcrypt.hash("E2ETestPass123!", 10),
        isApplicant: false,
        isEmployer: true,
        isVerified: true,
        emailVerified: true,
      },
    })

    // Create employer profile
    const empProfile = await db.employerProfile.upsert({
      where: { userId: employer.clerkId },
      update: { companyName: "E2E Test Corp" },
      create: {
        userId: employer.clerkId,
        companyName: "E2E Test Corp",
        contactEmail: "e2e-employer@test.com",
        industry: "Technology",
      },
    })

    // Create company and membership
    const company = await db.company.findFirst()
    if (company) {
      await db.companyMember.upsert({
        where: { companyId_userId: { companyId: company.id, userId: employer.clerkId } },
        update: {},
        create: { companyId: company.id, userId: employer.clerkId, role: "EMPLOYER" as any },
      })
    }

    // Create test job
    const job = await db.job.upsert({
      where: { slug: "e2e-test-job" },
      update: {},
      create: {
        title: "E2E Test Position",
        slug: "e2e-test-job",
        description: "This is a test job for E2E testing purposes.",
        jobType: "FULL_TIME" as any,
        experienceLevel: "MID" as any,
        workMode: "REMOTE" as any,
        remoteWork: true,
        status: "PUBLISHED" as any,
        isActive: true,
        employerId: employer.clerkId,
        companyId: company?.id || null,
        requiredSkills: ["Testing", "TypeScript"],
      },
    })

    // Create seed message so Messages page has a conversation
    await db.message.create({
      data: {
        senderId: employer.clerkId,
        receiverId: applicant.clerkId,
        content: "Thank you for your application. We would like to schedule an interview.",
      },
    })

    return res.json({
      success: true,
      data: {
        applicantEmail: applicant.email,
        employerEmail: employer.email,
        applicantClerkId: applicant.clerkId,
        employerClerkId: employer.clerkId,
        password: "E2ETestPass123!",
        jobSlug: job.slug,
        jobId: job.id,
      },
    })
  } catch (error) {
    console.error("Test setup error:", error)
    return res.status(500).json({ success: false, error: "Setup failed" })
  }
})

// POST /api/test/teardown - Remove test data
router.post("/teardown", async (_req: Request, res: Response) => {
  try {
    const testEmails = ["e2e-applicant@test.com", "e2e-employer@test.com"]

    for (const email of testEmails) {
      const user = await db.user.findUnique({ where: { email } })
      if (user) {
        await db.jobApplication.deleteMany({ where: { userId: user.clerkId } })
        await db.job.deleteMany({ where: { employerId: user.clerkId } })
        await db.companyMember.deleteMany({ where: { userId: user.clerkId } })
        await db.employerProfile.deleteMany({ where: { userId: user.clerkId } })
        await db.userProfile.deleteMany({ where: { userId: user.clerkId } })
        await db.resume.deleteMany({ where: { userId: user.clerkId } })
        await db.savedJob.deleteMany({ where: { userId: user.clerkId } })
        await db.message.deleteMany({ where: { OR: [{ senderId: user.clerkId }, { receiverId: user.clerkId }] } })
        await db.notification.deleteMany({ where: { userId: user.clerkId } })
        await db.user.delete({ where: { email } })
      }
    }

    return res.json({ success: true })
  } catch (error) {
    console.error("Test teardown error:", error)
    return res.status(500).json({ success: false, error: "Teardown failed" })
  }
})

export default router

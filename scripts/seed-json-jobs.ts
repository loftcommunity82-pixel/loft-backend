import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const JOBS_JSON_PATH = "../loft_commmunity/client/src/data/jobs.json"

async function main() {
  const fs = await import("fs")
  const raw = fs.readFileSync(JOBS_JSON_PATH, "utf-8")
  const data = JSON.parse(raw)
  const jobs: any[] = data.jobs || []

  console.log(`Found ${jobs.length} jobs in JSON data`)

  const employerProfile = await prisma.employerProfile.findFirst()
  if (!employerProfile) {
    console.error("No employer profile found in DB.")
    process.exit(1)
  }

  const company = await prisma.company.findFirst()
  if (!company) {
    console.error("No company found in DB.")
    process.exit(1)
  }

  let created = 0
  let skipped = 0

  for (const j of jobs) {
    const existing = await prisma.job.findUnique({ where: { slug: j.slug } })
    if (existing) {
      skipped++
      continue
    }

    await prisma.job.create({
      data: {
        title: j.title,
        slug: j.slug,
        description: j.description || "",
        requirements: j.requirements || null,
        benefits: Array.isArray(j.benefits) ? (j.benefits.length > 0 ? j.benefits.join("\n") : null) : (j.benefits || null),
        jobType: j.jobType || "FULL_TIME",
        experienceLevel: j.experienceLevel || "MID",
        workMode: j.workMode || "REMOTE",
        location: j.location || null,
        city: j.city || null,
        country: j.country || null,
        remoteWork: j.remoteWork ?? true,
        salaryMin: j.salaryMin ? j.salaryMin : null,
        salaryMax: j.salaryMax ? j.salaryMax : null,
        salaryCurrency: j.salaryCurrency || "USD",
        salaryPeriod: j.salaryPeriod || "YEARLY",
        isSalaryVisible: j.isSalaryVisible ?? true,
        requiredSkills: j.requiredSkills || j.skills || [],
        preferredSkills: j.preferredSkills || [],
        status: "PUBLISHED",
        isFeatured: j.isFeatured ?? false,
        isActive: j.isActive ?? true,
        applicationUrl: j.applicationUrl || null,
        applicationEmail: j.applicationEmail || null,
        employerId: employerProfile.userId,
        companyId: company.id,
        applicationsCount: 0,
        viewsCount: 0,
        publishedAt: new Date(),
      },
    })
    created++
  }

  console.log(`Done: ${created} created, ${skipped} skipped`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

const employers = [
  { email: "special1@loftcommunity.com", password: "Sp1!xK92mP7qR", name: "Special Employer 1" },
  { email: "special2@loftcommunity.com", password: "Sp2!vN45bT8wL", name: "Special Employer 2" },
  { email: "special3@loftcommunity.com", password: "Sp3!hJ78cF3zX", name: "Special Employer 3" },
  { email: "special4@loftcommunity.com", password: "Sp4!pQ61dG5yM", name: "Special Employer 4" },
  { email: "special5@loftcommunity.com", password: "Sp5!wE93sH1nK", name: "Special Employer 5" },
]

async function main() {
  const company = await prisma.company.findUnique({ where: { slug: "loft-community" } })
  if (!company) {
    console.error("Company 'loft-community' not found. Run the main seed first.")
    process.exit(1)
  }

  for (const emp of employers) {
    const existing = await prisma.user.findUnique({ where: { email: emp.email } })
    if (existing) {
      console.log(`User ${emp.email} already exists, updating password...`)
      const hash = await bcrypt.hash(emp.password, 12)
      await prisma.user.update({
        where: { email: emp.email },
        data: { hashedPassword: hash, isEmployer: true, isApplicant: false },
      })
      const member = await prisma.companyMember.findUnique({
        where: { companyId_userId: { companyId: company.id, userId: existing.clerkId } },
      })
      if (!member) {
        await prisma.companyMember.create({
          data: { companyId: company.id, userId: existing.clerkId, role: "EMPLOYER" },
        })
        console.log(`  -> Added company membership for ${emp.email}`)
      } else {
        console.log(`  -> Company membership already exists for ${emp.email}`)
      }
      console.log(`  -> Password updated`)
    } else {
      const clerkId = `local_sp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      const hash = await bcrypt.hash(emp.password, 12)
      await prisma.user.create({
        data: {
          clerkId,
          email: emp.email,
          name: emp.name,
          firstName: emp.name.split(" ")[0],
          lastName: emp.name.split(" ")[1],
          hashedPassword: hash,
          isEmployer: true,
          isApplicant: false,
          emailVerified: true,
        },
      })
      await prisma.companyMember.create({
        data: { companyId: company.id, userId: clerkId, role: "EMPLOYER" },
      })
      console.log(`Created ${emp.email} / ${emp.password}`)
    }
  }

  console.log("\nDone! Add these emails to ADMIN_EMAILS in .env:\n")
  console.log(`ADMIN_EMAILS=admin@loftcommunity.com,${employers.map(e => e.email).join(",")}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@loftcommunity.com"
  const password = process.env.ADMIN_PASSWORD || "Admin123!"

  const hash = await bcrypt.hash(password, 12)

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.error(`User not found: ${email}`)
    process.exit(1)
  }

  await prisma.user.update({
    where: { email },
    data: { hashedPassword: hash },
  })

  console.log(`Password set for ${email}`)
  console.log(`Login: ${email} / ${password}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

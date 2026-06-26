import { db } from "./db"
import type { JwtUser } from "../types"

export interface CompanySession {
  userId: string
  email: string
  companyId: number
  role: "ADMIN" | "EMPLOYER"
}

export async function getCompanySession(user: JwtUser): Promise<CompanySession | null> {
  const dbUser = await db.user.findUnique({
    where: { email: user.email },
    include: {
      companyMemberships: {
        include: { company: true },
        take: 1,
      },
    },
  })

  if (!dbUser || dbUser.companyMemberships.length === 0) return null

  const membership = dbUser.companyMemberships[0]
  return {
    userId: dbUser.clerkId,
    email: dbUser.email,
    companyId: membership.companyId,
    role: membership.role,
  }
}

export async function requireAdmin(user: JwtUser): Promise<CompanySession> {
  const cs = await getCompanySession(user)
  if (!cs) throw Object.assign(new Error("Unauthorized"), { status: 401 })
  if (cs.role !== "ADMIN") throw Object.assign(new Error("Forbidden: admin role required"), { status: 403 })
  return cs
}

export async function requireCompanyMember(user: JwtUser): Promise<CompanySession> {
  const cs = await getCompanySession(user)
  if (!cs) throw Object.assign(new Error("Unauthorized"), { status: 401 })
  return cs
}

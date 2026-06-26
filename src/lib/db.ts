import { PrismaClient } from "@prisma/client"

declare global {
  var prisma: PrismaClient | undefined
}

export const db = globalThis.prisma || new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
})

if (process.env.NODE_ENV !== "production") globalThis.prisma = db

export async function testDbConnection() {
  try {
    await db.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

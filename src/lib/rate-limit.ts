import { db } from "./db"

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number }> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowMs)

  try {
    await db.rateLimit.deleteMany({
      where: { expiresAt: { lt: now } },
    })

    const existing = await db.rateLimit.findUnique({ where: { key } })

    if (!existing || existing.windowStart < windowStart) {
      await db.rateLimit.upsert({
        where: { key },
        update: {
          count: 1,
          windowStart: now,
          expiresAt: new Date(now.getTime() + windowMs),
        },
        create: {
          key,
          count: 1,
          windowStart: now,
          expiresAt: new Date(now.getTime() + windowMs),
        },
      })
      return { success: true, remaining: limit - 1 }
    }

    if (existing.count >= limit) {
      return { success: false, remaining: 0 }
    }

    await db.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    })

    return { success: true, remaining: limit - existing.count - 1 }
  } catch {
    return { success: true, remaining: limit - 1 }
  }
}

import jwt from "jsonwebtoken"
import { serialize } from "cookie"
import env from "../config/env"
import type { JwtUser } from "../types"

const COOKIE_NAME = "auth-token"
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60

export function signToken(user: JwtUser): string {
  return jwt.sign(
    {
      userId: user.userId,
      clerkId: user.clerkId,
      email: user.email,
      isEmployer: user.isEmployer,
      isApplicant: user.isApplicant,
      companyId: user.companyId,
      companyRole: user.companyRole,
    },
    env.jwtSecret,
    { expiresIn: "30d" }
  )
}

export function verifyToken(token: string): JwtUser | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JwtUser
    return decoded
  } catch {
    return null
  }
}

export function createCookie(token: string): string {
  return serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })
}

export function clearCookie(): string {
  return serialize(COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

export function extractToken(req: { cookies?: Record<string, string>; headers?: Record<string, string | string[] | undefined> }): string | null {
  const fromCookie = req.cookies?.[COOKIE_NAME]
  if (fromCookie) return fromCookie

  const authHeader = req.headers?.authorization as string | undefined
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  return null
}

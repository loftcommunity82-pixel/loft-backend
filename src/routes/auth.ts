import { Router, Request, Response } from "express"
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { db } from "../lib/db"
import { signToken, createCookie, clearCookie } from "../lib/jwt"
import { requireAuth } from "../middleware/auth"
import { rateLimit } from "../lib/rate-limit"
import {
  registerUser,
  loginUser,
  requestPasswordReset,
  updatePassword,
  validatePassword,
  isPasswordStrongEnough,
  isValidEmail,
} from "../lib/auth-service"
import { sendEmail } from "../lib/email"
import { createLogger } from "../lib/logger"
import env from "../config/env"
import type { AuthenticatedRequest, RegisterInput, LoginInput, OAuthInput } from "../types"

const router = Router()
const log = createLogger("auth")

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  const ip = req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown"
  const { success } = await rateLimit(`register:${ip}`, 5, 60000)
  if (!success) {
    return res.status(429).json({ success: false, message: "Too many requests. Try again later." })
  }

  try {
    const { email, password, firstName, lastName, role: rawRole } = req.body

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ success: false, message: "Missing required fields" })
    }

    const passwordReq = validatePassword(password)
    if (!isPasswordStrongEnough(passwordReq)) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters with uppercase and number" })
    }

    const input: RegisterInput = {
      email,
      password,
      confirmPassword: password,
      firstName,
      lastName,
      role: (rawRole || "JOB_SEEKER").toLowerCase() === "employer" ? "employer" : "job_seeker",
    }

    const result = await registerUser(input)
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message })
    }

    const verificationToken = crypto.randomBytes(32).toString("hex")
    await db.verificationToken.create({
      data: {
        identifier: email.toLowerCase(),
        token: verificationToken,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    if (result.user?.clerkId) {
      await db.notification.create({
        data: {
          userId: result.user.clerkId,
          title: "Welcome to Loft Community!",
          message: `Hi ${firstName}! Your account has been created successfully. Start exploring job opportunities and build your career with us.`,
          type: "MESSAGE",
          link: "/dashboard",
        },
      })
    }

    // Generate and set JWT cookie
    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (user) {
      const token = signToken({
        userId: user.id.toString(),
        clerkId: user.clerkId,
        email: user.email,
        isEmployer: user.isEmployer,
        isApplicant: user.isApplicant,
      })
      res.setHeader("Set-Cookie", createCookie(token))
    }

    return res.status(201).json({
      success: true,
      message: "User created successfully. Please check your email to verify your account.",
      user: result.user,
    })
  } catch (error) {
    log.error("Register error", error)
    return res.status(500).json({ success: false, message: "Internal server error" })
  }
})

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" })
    }

    const result = await loginUser({ email, password } as LoginInput)
    if (!result.success || !result.user) {
      return res.status(401).json({ success: false, message: result.message })
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" })
    }

    const token = signToken({
      userId: user.id.toString(),
      clerkId: user.clerkId,
      email: user.email,
      isEmployer: user.isEmployer,
      isApplicant: user.isApplicant,
    })

    res.setHeader("Set-Cookie", createCookie(token))

    return res.json({
      success: true,
      user: result.user,
    })
  } catch (error) {
    log.error("Login error", error)
    return res.status(500).json({ success: false, message: "Internal server error" })
  }
})

// POST /api/auth/logout
router.post("/logout", (_req: Request, res: Response) => {
  res.setHeader("Set-Cookie", clearCookie())
  return res.json({ success: true, message: "Logged out successfully" })
})

// GET /api/auth/me
router.get("/me", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await db.user.findUnique({
      where: { email: req.user!.email },
      select: {
        id: true,
        clerkId: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        profileImage: true,
        isEmployer: true,
        isApplicant: true,
        emailVerified: true,
        tier: true,
        credits: true,
        createdAt: true,
      },
    })

    if (!user) {
      return res.status(401).json({ error: "User not found" })
    }

    return res.json({
      user: {
        id: user.clerkId,
        clerkId: user.clerkId,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        name: user.name || undefined,
        profileImage: user.profileImage || undefined,
        role: user.isEmployer ? "employer" : "job_seeker",
        isVerified: user.emailVerified === true,
        tier: user.tier,
        credits: user.credits,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    log.error("Get current user error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/auth/oauth - Handle OAuth login (Google/LinkedIn)
// Frontend handles OAuth UI, sends provider + accessToken to this endpoint
router.post("/oauth", async (req: Request, res: Response) => {
  try {
    const { provider, accessToken } = req.body as OAuthInput

    if (!provider || !accessToken) {
      return res.status(400).json({ success: false, message: "Provider and access token are required" })
    }

    // Verify the OAuth token with the provider
    let email: string | null = null
    let name: string | null = null
    let picture: string | null = null

    if (provider === "google") {
      const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${accessToken}`)
      if (!response.ok) {
        const altResponse = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`)
        if (!altResponse.ok) {
          return res.status(401).json({ success: false, message: "Invalid Google token" })
        }
        const data: any = await altResponse.json()
        email = data.email
        name = data.name
        picture = data.picture
      } else {
        const data: any = await response.json()
        email = data.email
        name = data.name
        picture = data.picture
      }
    } else {
      return res.status(400).json({ success: false, message: "Unsupported provider" })
    }

    if (!email) {
      return res.status(400).json({ success: false, message: "Could not retrieve email from provider" })
    }

    // Find or create user
    let user = await db.user.findUnique({ where: { email: email.toLowerCase() } })

    if (!user) {
      const clerkId = `oauth_${provider}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      user = await db.user.create({
        data: {
          clerkId,
          email: email.toLowerCase(),
          name: name || email.split("@")[0],
          profileImage: picture,
          isEmployer: false,
          isApplicant: true,
          emailVerified: true, // OAuth emails are pre-verified
        },
      })
      await db.userProfile.create({ data: { userId: user.clerkId } })
    }

    const token = signToken({
      userId: user.id.toString(),
      clerkId: user.clerkId,
      email: user.email,
      isEmployer: user.isEmployer,
      isApplicant: user.isApplicant,
    })

    res.setHeader("Set-Cookie", createCookie(token))

    return res.json({
      success: true,
      user: {
        id: user.clerkId,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name || undefined,
        profileImage: user.profileImage || undefined,
        role: user.isEmployer ? "employer" : "job_seeker",
        isVerified: user.emailVerified === true,
        tier: user.tier,
        credits: user.credits,
        createdAt: user.createdAt,
      },
    })
  } catch (error) {
    log.error("OAuth error", error)
    return res.status(500).json({ success: false, message: "Internal server error" })
  }
})

// GET /api/auth/verify-email?token=...
router.get("/verify-email", async (req: Request, res: Response) => {
  const token = req.query.token as string

  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required" })
  }

  const vt = await db.verificationToken.findUnique({ where: { token } })
  if (!vt) {
    return res.status(400).json({ success: false, message: "Invalid or expired token" })
  }

  if (vt.expires < new Date()) {
    await db.verificationToken.delete({ where: { token } })
    return res.status(400).json({ success: false, message: "Token has expired" })
  }

  await db.user.update({
    where: { email: vt.identifier },
    data: { emailVerified: true },
  })

  await db.verificationToken.delete({ where: { token } })

  return res.json({ success: true, message: "Email verified successfully" })
})

// POST /api/auth/verify-email - Resend verification email
router.post("/verify-email", async (req: Request, res: Response) => {
  const { email } = req.body
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" })
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" })
  }

  if (user.emailVerified) {
    return res.status(400).json({ success: false, message: "Email already verified" })
  }

  await db.verificationToken.deleteMany({ where: { identifier: email } })

  const token = crypto.randomBytes(32).toString("hex")
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await db.verificationToken.create({
    data: { identifier: email, token, expires },
  })

  const verificationUrl = `${env.frontendUrl}/api/auth/verify-email?token=${token}`

  try {
    await sendEmail({
      to: email,
      subject: "Verify your LoftCommunity email",
      html: `<p>Click <a href="${verificationUrl}">here</a> to verify your email address.</p><p>This link expires in 24 hours.</p>`,
    })
  } catch {
    // Email sending failed, but token is still created
  }

  return res.json({ success: true, message: "Verification email sent" })
})

// POST /api/auth/reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
  const ip = req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown"
  const { success } = await rateLimit(`reset:${ip}`, 3, 60000)
  if (!success) {
    return res.status(429).json({ success: false, message: "Too many requests. Try again later." })
  }

  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" })
    }

    const result = await requestPasswordReset(email)
    return res.json(result)
  } catch (error) {
    log.error("Reset password error", error)
    return res.status(500).json({ success: false, message: "Internal server error" })
  }
})

// POST /api/auth/update-password
router.post("/update-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword, confirmPassword } = req.body

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: "All fields are required" })
    }

    const passwordReq = validatePassword(newPassword)
    if (!isPasswordStrongEnough(passwordReq)) {
      return res.status(400).json({ success: false, message: "Password does not meet all requirements" })
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "Passwords do not match" })
    }

    const result = await updatePassword({ token, newPassword, confirmPassword })
    if (!result.success) {
      return res.status(400).json(result)
    }

    return res.json(result)
  } catch (error) {
    log.error("Update password error", error)
    return res.status(500).json({ success: false, message: "Internal server error" })
  }
})

export default router

import { Request } from "express"

export interface JwtUser {
  userId: string
  clerkId: string
  email: string
  isEmployer: boolean
  isApplicant: boolean
  companyId?: number
  companyRole?: "ADMIN" | "EMPLOYER"
}

export interface AuthenticatedRequest extends Request {
  user?: JwtUser
}

export type UserRole = "employer" | "job_seeker"

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  email: string
  password: string
  confirmPassword: string
  firstName: string
  lastName: string
  role: UserRole
}

export interface ResetPasswordInput {
  email: string
}

export interface UpdatePasswordInput {
  token: string
  newPassword: string
  confirmPassword: string
}

export interface OAuthInput {
  provider: "google" | "linkedin"
  accessToken: string
}

export interface AuthUser {
  id: string
  clerkId: string
  email: string
  firstName?: string
  lastName?: string
  name?: string
  profileImage?: string
  role: UserRole
  isVerified: boolean
  tier: string
  credits: string
  createdAt: Date
}

export interface AuthResponse {
  success: boolean
  message: string
  user?: AuthUser
}

export interface PasswordRequirements {
  minLength: boolean
  hasUppercase: boolean
  hasLowercase: boolean
  hasNumber: boolean
  hasSpecialChar: boolean
}

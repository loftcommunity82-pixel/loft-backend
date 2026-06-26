const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  isDev: (process.env.NODE_ENV || "development") === "development",
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  frontendUrl: process.env.FRONTEND_URL || process.env.NEXTAUTH_URL || "http://localhost:3000",
  resendApiKey: process.env.RESEND_API_KEY || "",
  supportEmail: process.env.SUPPORT_EMAIL || "support@loftcommunity.com",
  stripeSecret: process.env.STRIPE_SECRET || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
}

export default env

import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import env from "./config/env"
import { errorHandler } from "./middleware/error-handler"

import authRoutes from "./routes/auth"
import healthRoutes from "./routes/health"
import jobsRoutes from "./routes/jobs"
import applicationsRoutes from "./routes/applications"
import usersRoutes from "./routes/users"
import notificationsRoutes from "./routes/notifications"
import companiesRoutes from "./routes/companies"
import adminRoutes from "./routes/admin"
import messagesRoutes from "./routes/messages"
import skillsRoutes from "./routes/skills"
import interviewsRoutes from "./routes/interviews"
import paymentRoutes from "./routes/payment"
import contactRoutes from "./routes/contact"
import uploadthingRoutes from "./routes/uploadthing"
import sseRoutes from "./routes/sse"
import testRoutes from "./routes/test"

const app = express()

app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}))
app.use(cookieParser())
app.use(express.json({ limit: '10mb' }))

app.use("/api/auth", authRoutes)
app.use("/api/health", healthRoutes)
app.use("/api/jobs", jobsRoutes)
app.use("/api/applications", applicationsRoutes)
app.use("/api/users", usersRoutes)
app.use("/api/notifications", notificationsRoutes)
app.use("/api/companies", companiesRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/messages", messagesRoutes)
app.use("/api/skills", skillsRoutes)
app.use("/api/interviews", interviewsRoutes)
app.use("/api/payment", paymentRoutes)
app.use("/api/contact", contactRoutes)
app.use("/api/uploadthing", uploadthingRoutes)
app.use("/api/sse", sseRoutes)

if (env.isDev) {
  app.use("/api/test", testRoutes)
}

app.use(errorHandler)

app.listen(env.port, () => {
  console.log(`Loft API running on port ${env.port}`)
})

export default app

import { Router, Response } from "express"
import { db } from "../lib/db"
import { requireAuth } from "../middleware/auth"
import { sendEmail, emailTemplates, shouldSendEmail } from "../lib/email"
import { createLogger } from "../lib/logger"
import type { AuthenticatedRequest } from "../types"

const router = Router()
const log = createLogger("messages")

// GET /api/messages - List conversations
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const jobId = req.query.jobId as string

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const whereClause: any = { OR: [{ senderId: user.clerkId }, { receiverId: user.clerkId }] }
    if (jobId) whereClause.jobId = parseInt(jobId)

    const messages = await db.message.findMany({
      where: whereClause,
      orderBy: { createdAt: "asc" },
      include: { sender: { select: { id: true, name: true, firstName: true, lastName: true, profileImage: true } }, receiver: { select: { id: true, name: true, firstName: true, lastName: true, profileImage: true } } },
    })

    return res.json(messages.map(msg => ({
      id: msg.id, content: msg.content, jobId: msg.jobId, readAt: msg.readAt,
      createdAt: msg.createdAt, isOwn: msg.senderId === user.clerkId,
      sender: msg.sender, receiver: msg.receiver,
    })))
  } catch (error) {
    log.error("List messages error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/messages - Send message
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const { receiverId, content, jobId } = req.body
    if (!receiverId || !content) return res.status(400).json({ error: "Missing required fields" })

    // Verify candidate is at INTERVIEW stage if jobId provided
    if (jobId) {
      const application = await db.jobApplication.findFirst({ where: { jobId: parseInt(jobId), userId: receiverId } })
      if (!application) return res.status(404).json({ error: "Application not found" })
      if (application.status !== "INTERVIEW" && application.status !== "OFFERED") {
        return res.status(403).json({ error: "Messaging only available when candidate is at Interview stage" })
      }
    }

    const message = await db.message.create({
      data: { senderId: user.clerkId, receiverId, content, jobId: jobId ? parseInt(jobId) : null },
    })

    const senderName = user.firstName || user.name || "Employer"

    await db.notification.create({
      data: { userId: receiverId, title: "New Message", message: `You have a new message from ${senderName}`, type: "MESSAGE", link: "/dashboard/messages" },
    })

    const receiver = await db.user.findUnique({ where: { clerkId: receiverId } })
    if (receiver?.email) {
      const shouldNotify = await shouldSendEmail(receiverId, "newMessages")
      if (shouldNotify) await sendEmail(emailTemplates.newMessage(senderName, receiver.email))
    }

    return res.json({ success: true, message: { id: message.id, content: message.content, createdAt: message.createdAt } })
  } catch (error) {
    log.error("Send message error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/messages/:id/read - Mark message as read
router.post("/:id/read", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userEmail = req.user!.email
    const messageId = parseInt(req.params.id)
    if (isNaN(messageId)) return res.status(400).json({ error: "Invalid message ID" })

    const user = await db.user.findUnique({ where: { email: userEmail } })
    if (!user) return res.status(404).json({ error: "User not found" })

    const message = await db.message.findUnique({ where: { id: messageId } })
    if (!message) return res.status(404).json({ error: "Message not found" })
    if (message.receiverId !== user.clerkId) return res.status(403).json({ error: "Not authorized" })

    await db.message.update({ where: { id: messageId }, data: { readAt: new Date() } })
    return res.json({ success: true })
  } catch (error) {
    log.error("Mark message read error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

export default router

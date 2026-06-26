import { Router, Request, Response } from "express"
import { sendEmail } from "../lib/email"
import { createLogger } from "../lib/logger"
import env from "../config/env"

const router = Router()
const log = createLogger("contact")

// POST /api/contact - Send contact form
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email, subject, message } = req.body

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "Name, email, subject, and message are required" })
    }

    if (!email.includes("@")) {
      return res.status(400).json({ error: "Invalid email address" })
    }

    const result = await sendEmail({
      to: env.supportEmail,
      subject: `[Contact Support] ${subject} - from ${name}`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #10b981;">Contact Support Request</h1>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">From:</td><td style="padding: 8px;">${name}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">Email:</td><td style="padding: 8px;"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding: 8px; font-weight: bold; color: #666;">Subject:</td><td style="padding: 8px;">${subject}</td></tr>
          </table>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #333; line-height: 1.6;">${message.replace(/\n/g, "<br/>")}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Sent from LoftCommunity Contact Support form</p>
        </body>
        </html>
      `,
    })

    if (result.success) {
      return res.json({ success: true, message: "Message sent successfully" })
    }

    return res.status(500).json({
      error: "Failed to send message. Please try emailing us directly.",
      mailtoFallback: `mailto:${env.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`From: ${name} (${email})\n\n${message}`)}`,
    })
  } catch {
    return res.status(500).json({ error: "Internal server error. Please try emailing us directly." })
  }
})

export default router

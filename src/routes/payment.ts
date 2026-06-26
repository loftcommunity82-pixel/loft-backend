import { Router, Request, Response } from "express"
import Stripe from "stripe"
import env from "../config/env"
import { createLogger } from "../lib/logger"

const router = Router()
const log = createLogger("payment")

function getStripe(): Stripe {
  return new Stripe(env.stripeSecret, { typescript: true, apiVersion: "2023-10-16" })
}

// GET /api/payment - List products/prices
router.get("/", async (_req: Request, res: Response) => {
  try {
    const stripe = getStripe()
    const products = await stripe.prices.list({ limit: 3 })
    return res.json(products.data)
  } catch (error) {
    log.error("List prices error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// POST /api/payment - Create checkout session
router.post("/", async (req: Request, res: Response) => {
  try {
    const stripe = getStripe()
    const data = req.body
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: data.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${env.frontendUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.frontendUrl}/billing`,
    })
    return res.json(session.url)
  } catch (error) {
    log.error("Create checkout session error", error)
    return res.status(500).json({ error: "Internal server error" })
  }
})

export default router

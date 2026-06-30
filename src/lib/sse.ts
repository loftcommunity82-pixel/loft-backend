import type { Response } from "express"

const clients = new Map<string, Set<Response>>()
const MAX_CONNECTIONS_PER_USER = 5

function getClientCount(clerkId: string): number {
  return clients.get(clerkId)?.size ?? 0
}

export function addClient(clerkId: string, res: Response): boolean {
  if (getClientCount(clerkId) >= MAX_CONNECTIONS_PER_USER) {
    return false
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })
  res.write(":\n\n")

  if (!clients.has(clerkId)) {
    clients.set(clerkId, new Set())
  }
  clients.get(clerkId)!.add(res)

  res.on("close", () => {
    const set = clients.get(clerkId)
    if (set) {
      set.delete(res)
      if (set.size === 0) clients.delete(clerkId)
    }
  })

  return true
}

export function sendEvent(clerkId: string, event: string, data: unknown) {
  const set = clients.get(clerkId)
  if (set) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of set) {
      res.write(payload)
    }
  }
}

export function getConnectedUserCount(): number {
  return clients.size
}

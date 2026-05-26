import type { NextApiRequest, NextApiResponse } from "next"

type ApiHandler = (req: NextApiRequest, res: NextApiResponse) => void | Promise<void>

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

function setCors(req: NextApiRequest, res: NextApiResponse) {
  const origin = req.headers.origin || ""
  const allowed =
    ALLOWED_ORIGINS.length === 0 ||
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGINS.includes("*")
  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Telegram-Init-Data")
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Vary", "Origin")
  }
}

export function runApi(handler: ApiHandler) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    setCors(req, res)
    if (req.method === "OPTIONS") {
      res.status(204).end()
      return
    }
    try {
      await handler(req, res)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error"
      console.error("API error:", err)
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: message })
      }
    }
  }
}

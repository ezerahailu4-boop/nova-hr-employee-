import type { NextApiRequest, NextApiResponse } from "next"
import { requireAdmin } from "../../../lib/auth"
import { sendMessage } from "../../../lib/telegram"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" })
  if (!(await requireAdmin(req, res))) return

  const { telegram_id, message } = req.body

  if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id is required" })
  if (!message?.trim()) return res.status(400).json({ success: false, error: "message is required" })

  try {
    await sendMessage(telegram_id, message, { parse_mode: "Markdown" })
    return res.status(200).json({ success: true })
  } catch (e: any) {
    console.error("Telegram send error:", e.message)
    return res.status(500).json({ success: false, error: e.message })
  }
}

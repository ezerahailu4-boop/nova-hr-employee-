import type { NextApiRequest, NextApiResponse } from "next"
import { requireAdmin } from "../../../lib/auth"
import { supabaseAdmin } from "../../../lib/supabase"
import { sendMessage } from "../../../lib/telegram"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" })
  if (!(await requireAdmin(req, res))) return
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ success: false, error: "message is required" })

  // Fetch all users who have ever clicked /start
  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("telegram_id, first_name, username")

  if (error) return res.status(500).json({ success: false, error: error.message })
  if (!users?.length) return res.status(200).json({ success: true, sent: 0, total: 0 })

  let sent = 0
  const failed: number[] = []

  for (const user of users) {
    try {
      await sendMessage(user.telegram_id, message, { parse_mode: "Markdown" })
      sent++
    } catch (e: any) {
      console.warn(`Failed to send to ${user.telegram_id}:`, e.message)
      failed.push(user.telegram_id)
    }
    // Small delay to avoid Telegram rate limits (30 msg/sec)
    await new Promise(r => setTimeout(r, 40))
  }

  return res.status(200).json({ success: true, sent, total: users.length, failed })
}

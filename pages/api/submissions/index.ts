import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"
import { verifyTelegramInitData } from "../../../lib/telegram-auth"

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  const auth = req.headers.authorization || ""
  const isAdmin = auth.startsWith("Bearer ")

  // Admin: full access
  if (isAdmin) {
    if (!(await requireAdmin(req, res))) return
    if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("submissions")
        .select("*")
        .order("timestamp", { ascending: false })
      if (error) return res.status(500).json({ success: false, error: error.message })
      return res.status(200).json(data || [])
    }

    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  // User: only their own submissions (verified via Telegram init data)
  const initData = req.headers["x-telegram-init-data"] as string
  const user = verifyTelegramInitData(initData || "")

  if (req.method === "GET") {
    if (!user) return res.status(200).json([])
    if (!supabaseAdmin) return res.status(200).json([])

    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select("id,timestamp,status,position,full_name,phone,email,source,submitted_at,interview,attachments,cv_path")
      .eq("telegram_id", user.id)
      .order("timestamp", { ascending: false })
      .limit(20)

    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json(data || [])
  }

  return res.status(405).json({ success: false, error: "Method not allowed" })
})

import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (!(await requireAdmin(req, res))) return
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  const { subId } = req.query
  if (!subId || typeof subId !== "string") {
    return res.status(400).json({ success: false, error: "Submission ID required" })
  }

  if (req.method === "PATCH") {
    const { status, interview } = req.body
    const update: Record<string, any> = { updated_at: new Date().toISOString() }

    if (status !== undefined) {
      const allowed = ["pending", "pending_cv", "accepted", "rejected"]
      if (!allowed.includes(status)) {
        return res.status(400).json({ success: false, error: "Invalid status value" })
      }
      update.status = status
    }
    if (interview !== undefined) update.interview = interview

    const { data, error } = await supabaseAdmin
      .from("submissions")
      .update(update)
      .eq("id", subId)
      .select()
      .single()

    if (error) return res.status(404).json({ success: false, error: "Submission not found" })
    return res.status(200).json({ success: true, submission: data })
  }

  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("submissions")
      .select("*")
      .eq("id", subId)
      .single()
    if (error) return res.status(404).json({ success: false, error: "Submission not found" })
    return res.status(200).json(data)
  }

  return res.status(405).json({ success: false, error: "Method not allowed" })
})

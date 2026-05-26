import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (!(await requireAdmin(req, res))) return
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  const { jobId } = req.query
  if (!jobId) return res.status(400).json({ success: false, error: "Job ID required" })
  const id = parseInt(jobId as string)
  if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid job ID" })

  if (req.method === "PUT") {
    const { title, company, location, type, salary, deadline, description, requirements, icon, category, color, remote } = req.body
    const { data: job, error } = await supabaseAdmin.from("jobs").update({
      title, company, location, type, salary, deadline,
      description,
      requirements: Array.isArray(requirements) ? requirements.join("\n") : String(requirements || ""),
      icon, category, color,
      remote: remote ?? location?.toLowerCase().includes("remote") ?? false,
      updated_at: new Date().toISOString(),
    }).eq("id", id).select().single()

    if (error) return res.status(404).json({ success: false, error: "Job not found" })
    return res.status(200).json({ success: true, job })
  }

  if (req.method === "DELETE") {
    const { error } = await supabaseAdmin.from("jobs").delete().eq("id", id)
    if (error) return res.status(404).json({ success: false, error: "Job not found" })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ success: false, error: "Method not allowed" })
})

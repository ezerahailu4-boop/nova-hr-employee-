import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
}

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (!(await requireAdmin(req, res))) return
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  const { jobId } = req.query
  if (!jobId) return res.status(400).json({ success: false, error: "Job ID required" })
  const id = parseInt(jobId as string)
  if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid job ID" })

  if (req.method === "PUT") {
    const { title, company, location, type, salary, deadline, description, requirements, icon, category, color, remote, image_base64, image_name } = req.body

    const update: Record<string, unknown> = {
      title, company, location, type, salary, deadline,
      description,
      requirements: Array.isArray(requirements) ? requirements.join("\n") : String(requirements || ""),
      icon, category, color,
      remote: remote ?? location?.toLowerCase().includes("remote") ?? false,
      updated_at: new Date().toISOString(),
    }

    if (image_base64) {
      try {
        const ext = (image_name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
        const buffer = Buffer.from(image_base64, "base64")
        const storagePath = `job-${id}-${Date.now()}.${ext}`
        const { error: uploadError } = await supabaseAdmin.storage
          .from("job-images")
          .upload(storagePath, buffer, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: false })
        if (!uploadError) {
          const { data: pub } = supabaseAdmin.storage.from("job-images").getPublicUrl(storagePath)
          if (pub?.publicUrl) update.image_url = pub.publicUrl
        } else {
          console.error("Job image upload error:", uploadError.message)
        }
      } catch (e) {
        console.error("Job image processing error:", (e as Error).message)
      }
    }

    const { data: job, error } = await supabaseAdmin.from("jobs").update(update).eq("id", id).select().single()

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

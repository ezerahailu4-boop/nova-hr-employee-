import { NextApiRequest, NextApiResponse } from "next"
import { supabase, supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"
import { sendMessage, sendPhoto, webappUrl } from "../../../lib/telegram"
import { JOBS_CHANNEL_ID } from "../../../lib/env"
import fs from "fs"
import path from "path"

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
}

function loadLocalJobs(): any[] {
  const candidates = [
    path.join(process.cwd(), "jobs.json"),
    path.join(process.cwd(), "public", "webapp", "jobs.json"),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""))
    } catch { /* try next */ }
  }
  return []
}

function formatJob(j: any) {
  return {
    ...j,
    company: j.company || "Nova HR SM",
    location: j.location || "Addis Ababa, Ethiopia",
    type: j.type || "Full-time",
    description: j.description || "No description provided.",
    requirements: j.requirements || "No specific requirements.",
    remote: j.location?.toLowerCase().includes("remote") || false,
  }
}

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "GET") {
    if (!supabase) return res.status(200).json(loadLocalJobs().map(formatJob))
    const { data: jobs, error } = await supabase.from("jobs").select("*").order("id", { ascending: true })
    if (error) {
      console.error("Supabase jobs error:", error.message)
      return res.status(200).json(loadLocalJobs().map(formatJob))
    }
    return res.status(200).json((jobs || []).map(formatJob))
  }

  if (req.method === "POST") {
    if (!(await requireAdmin(req, res))) return
    if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

    const { title, location, description, requirements, company, type, salary, deadline, color, icon, category, image_base64, image_name } = req.body
    if (!title || !location || !description || !requirements) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, location, description, requirements" })
    }

    let image_url: string | null = null
    if (image_base64) {
      try {
        const ext = (image_name?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg"
        const buffer = Buffer.from(image_base64, "base64")
        const storagePath = `job-${Date.now()}.${ext}`
        const { error: uploadError } = await supabaseAdmin.storage
          .from("job-images")
          .upload(storagePath, buffer, { contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, upsert: false })
        if (uploadError) {
          console.error("Job image upload error:", uploadError.message)
        } else {
          const { data: pub } = supabaseAdmin.storage.from("job-images").getPublicUrl(storagePath)
          image_url = pub?.publicUrl || null
        }
      } catch (e) {
        console.error("Job image processing error:", (e as Error).message)
      }
    }

    const { data: job, error } = await supabaseAdmin.from("jobs").insert({
      title,
      company: company || "Nova HR SM",
      location,
      type: type || "Full-time",
      remote: location?.toLowerCase().includes("remote") || false,
      salary: salary || "",
      deadline: deadline || "",
      description,
      requirements: Array.isArray(requirements) ? requirements.join("\n") : String(requirements),
      color: color || "#d97706",
      icon: icon || "💼",
      category: category || "",
      image_url,
      timestamp: new Date().toISOString(),
    }).select().single()

    if (error) return res.status(500).json({ success: false, error: error.message })

    // Auto-post to the Telegram jobs channel (non-blocking — failure here shouldn't fail the job creation)
    if (JOBS_CHANNEL_ID) {
      try {
        const link = `${webappUrl()}?job=${job.id}`
        const caption = `${job.icon || "💼"} *${job.title}*\n\n📍 ${job.location} · ${job.type}${job.salary ? `\n💰 ${job.salary}` : ""}${job.deadline ? `\n⏳ Deadline: ${job.deadline}` : ""}\n\n${job.description}\n\n👉 [Apply Now](${link})`
        if (job.image_url) {
          await sendPhoto(JOBS_CHANNEL_ID, job.image_url, caption, { parse_mode: "Markdown" })
        } else {
          await sendMessage(JOBS_CHANNEL_ID, caption, { parse_mode: "Markdown", disable_web_page_preview: false })
        }
      } catch (e) {
        console.error("Telegram channel post failed:", (e as Error).message)
      }
    }

    return res.status(201).json({ success: true, job })
  }

  return res.status(405).json({ success: false, error: "Method not allowed" })
})

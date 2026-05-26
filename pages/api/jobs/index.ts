import { NextApiRequest, NextApiResponse } from "next"
import { supabase, supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"
import fs from "fs"
import path from "path"

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

    const { title, location, description, requirements, company, type, salary, deadline, color, icon, category } = req.body
    if (!title || !location || !description || !requirements) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, location, description, requirements" })
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
      timestamp: new Date().toISOString(),
    }).select().single()

    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(201).json({ success: true, job })
  }

  return res.status(405).json({ success: false, error: "Method not allowed" })
})

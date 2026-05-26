import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../lib/supabase"
import { runApi } from "../../lib/api-handler"
import { verifyTelegramInitData } from "../../lib/telegram-auth"

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"]
const MAX_FILE_SIZE = 10 * 1024 * 1024

export const config = {
  api: { bodyParser: { sizeLimit: "15mb" } },
}

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" })
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  const initData = req.headers["x-telegram-init-data"] as string
  const user = verifyTelegramInitData(initData || "")

  const payload = req.body?.payload
    ? typeof req.body.payload === "string" ? JSON.parse(req.body.payload) : req.body.payload
    : req.body || {}

  const files: any[] = req.body?.files || []

  const allowedKeys = [
    "type", "position", "full_name", "phone", "email", "age", "gender",
    "education", "experience", "cover_letter", "portfolio_links", "bio",
    "documents", "submitted_at", "telegram_id", "telegram_username",
  ]

  const clean: Record<string, any> = {}
  for (const key of allowedKeys) {
    if (key in payload) clean[key] = payload[key]
  }
  if (user) {
    clean.telegram_id = user.id
    clean.telegram_username = user.username || "N/A"
  }

  const subId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}web`
  const savedFiles: any[] = []

  for (const file of files) {
    const ext = `.${(file.name?.split(".").pop() || "").toLowerCase()}`
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ success: false, error: `File type ${ext} not allowed` })
    }
    const buffer = Buffer.from(file.data, "base64")
    if (buffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ success: false, error: `File ${file.name} exceeds 10MB limit` })
    }
    const storagePath = `${subId}/${file.name}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from("cvs")
      .upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false })

    if (uploadError) {
      console.error("Storage upload error:", uploadError.message)
      return res.status(500).json({ success: false, error: `Failed to upload ${file.name}: ${uploadError.message}` })
    }

    // Store only path — generate signed URLs on demand so they never expire
    savedFiles.push({ name: file.name, path: storagePath, size: buffer.length, type: ext.slice(1).toUpperCase() })
  }

  const record = {
    id: subId,
    timestamp: new Date().toISOString(),
    status: "pending",
    source: clean.type || "webapp",
    ...clean,
    attachments: savedFiles.length > 0 ? savedFiles : null,
    cv_path: savedFiles[0]?.path || null,
  }

  const { data, error } = await supabaseAdmin.from("submissions").insert(record).select().single()
  if (error) {
    console.error("Supabase insert error:", error.message)
    return res.status(500).json({ success: false, error: error.message })
  }

  return res.status(201).json({ success: true, id: subId, saved: savedFiles, submission: data })
})

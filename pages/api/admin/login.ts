import { NextApiRequest, NextApiResponse } from "next"
import { supabase, supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import crypto from "crypto"

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || process.env.EMPLOYER_PASSWORD || ""
const MAX_ATTEMPTS = 5
const WINDOW_MINUTES = 15

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "nova_hr_salt_2025").digest("hex")
}

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" })

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown"
  const db = supabaseAdmin || supabase

  // Rate limiting
  if (db) {
    try {
      const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
      await db.from("login_attempts").delete().lt("attempted_at", cutoff)
      const { count } = await db.from("login_attempts").select("*", { count: "exact", head: true })
        .eq("ip", ip).eq("success", false).gte("attempted_at", cutoff)
      if ((count || 0) >= MAX_ATTEMPTS) {
        return res.status(429).json({ success: false, error: `Too many failed attempts. Wait ${WINDOW_MINUTES} minutes.` })
      }
    } catch { /* non-fatal */ }
  }

  const { username, password } = req.body || {}
  if (!password) return res.status(400).json({ success: false, error: "Password required" })

  let isValid = false
  let adminRole = "admin"
  let adminUsername = username || "admin"

  // 1) Check admins table first (multi-admin support)
  if (db && username) {
    try {
      const { data: adminRow } = await db
        .from("admins")
        .select("id, username, password_hash, role")
        .eq("username", username)
        .single()
      if (adminRow) {
        const hash = hashPassword(password)
        isValid = hash === adminRow.password_hash
        adminRole = adminRow.role
        adminUsername = adminRow.username
        if (isValid) {
          await db.from("admins").update({ last_login: new Date().toISOString() }).eq("id", adminRow.id)
        }
      }
    } catch { /* fall through to env check */ }
  }

  // 2) Fallback: env ADMIN_PASSWORD (original superadmin)
  if (!isValid && ADMIN_PASSWORD) {
    const pwBuf = Buffer.from(String(password))
    const adminBuf = Buffer.from(ADMIN_PASSWORD)
    if (pwBuf.length === adminBuf.length && crypto.timingSafeEqual(pwBuf, adminBuf)) {
      isValid = true
      adminRole = "superadmin"
      adminUsername = username || "admin"
    }
  }

  if (db) {
    try { await db.from("login_attempts").insert({ ip, success: isValid }) } catch { /* non-fatal */ }
  }

  if (!isValid) return res.status(401).json({ success: false, error: "Invalid username or password" })

  const token = crypto.randomBytes(32).toString("hex")
  if (db) {
    try {
      await db.from("admin_sessions").insert({
        token, ip,
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      })
    } catch { /* non-fatal */ }
  }

  return res.status(200).json({ success: true, token, role: adminRole, username: adminUsername })
})

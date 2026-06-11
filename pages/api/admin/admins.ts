import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../../lib/supabase"
import { requireAdmin } from "../../../lib/auth"
import crypto from "crypto"

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "nova_hr_salt_2025").digest("hex")
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdmin(req, res))) return
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  // GET — list all admins
  if (req.method === "GET") {
    const { data, error } = await supabaseAdmin
      .from("admins")
      .select("id, username, role, telegram_id, created_at, last_login")
      .order("created_at", { ascending: true })
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json(data)
  }

  // POST — create new admin
  if (req.method === "POST") {
    const { username, password, role = "admin" } = req.body
    if (!username?.trim()) return res.status(400).json({ success: false, error: "Username is required" })
    if (!password || password.length < 6) return res.status(400).json({ success: false, error: "Password must be at least 6 characters" })
    if (!["admin", "superadmin"].includes(role)) return res.status(400).json({ success: false, error: "Invalid role" })

    const insertData: any = { username: username.trim(), password_hash: hashPassword(password), role }
    if (req.body.telegram_id) insertData.telegram_id = Number(req.body.telegram_id)
    const { data, error } = await supabaseAdmin
      .from("admins")
      .insert(insertData)
      .select("id, username, role, created_at")
      .single()
    if (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, error: "Username already exists" })
      return res.status(500).json({ success: false, error: error.message })
    }
    return res.status(201).json({ success: true, admin: data })
  }

  // PATCH — change password
  if (req.method === "PATCH") {
    const { id, password } = req.body
    if (!id) return res.status(400).json({ success: false, error: "id is required" })
    if (!password || password.length < 6) return res.status(400).json({ success: false, error: "Password must be at least 6 characters" })

    const { error } = await supabaseAdmin
      .from("admins")
      .update({ password_hash: hashPassword(password) })
      .eq("id", id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json({ success: true })
  }

  // DELETE — remove admin
  if (req.method === "DELETE") {
    const { id } = req.body
    if (!id) return res.status(400).json({ success: false, error: "id is required" })

    const { error } = await supabaseAdmin.from("admins").delete().eq("id", id)
    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ success: false, error: "Method not allowed" })
}

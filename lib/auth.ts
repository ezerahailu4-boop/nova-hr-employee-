import type { NextApiRequest, NextApiResponse } from "next"
import crypto from "crypto"
import { supabaseAdmin } from "./supabase"
import { ADMIN_TOKEN } from "./env"

export function timingSafeTokenCheck(supplied: string, expected: string): boolean {
  if (!supplied || !expected) return false
  try {
    const a = Buffer.from(supplied)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function requireAdmin(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  const auth = req.headers.authorization || ""
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Authentication required" })
    return false
  }
  const supplied = auth.slice(7)

  // Check against env token (fast path)
  if (ADMIN_TOKEN && timingSafeTokenCheck(supplied, ADMIN_TOKEN)) return true

  // Check session store in Supabase
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from("admin_sessions")
      .select("expires_at")
      .eq("token", supplied)
      .single()
    if (data && new Date(data.expires_at) > new Date()) return true
  }

  res.status(401).json({ success: false, error: "Invalid or expired token" })
  return false
}

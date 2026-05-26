import { NextApiRequest, NextApiResponse } from "next"
import { supabaseAdmin } from "../../../lib/supabase"
import { runApi } from "../../../lib/api-handler"
import { requireAdmin } from "../../../lib/auth"

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" })
  if (!(await requireAdmin(req, res))) return
  if (!supabaseAdmin) return res.status(503).json({ success: false, error: "Supabase not configured" })

  const { filename } = req.query
  // filename may be "subId/actual-filename.pdf" URL-encoded — also allow subId as query param
  const subId = req.query.subId as string | undefined
  let storagePath = decodeURIComponent(filename as string)
  if (subId) storagePath = `${subId}/${storagePath}`

  // Generate a 1-hour signed URL on demand
  const { data, error } = await supabaseAdmin.storage
    .from("cvs")
    .createSignedUrl(storagePath, 3600)

  if (error || !data?.signedUrl) {
    return res.status(404).json({ success: false, error: "File not found or could not generate URL" })
  }

  // Redirect to the signed URL so the browser downloads the file directly
  res.redirect(302, data.signedUrl)
})

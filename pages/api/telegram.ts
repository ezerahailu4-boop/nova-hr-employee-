import { NextApiRequest, NextApiResponse } from "next"
import { runApi } from "../../lib/api-handler"
import { processTelegramUpdate } from "../../lib/telegram-webhook"

export const config = {
  api: { bodyParser: true },
}

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  await processTelegramUpdate(req.body)
  res.status(200).json({ ok: true })
})

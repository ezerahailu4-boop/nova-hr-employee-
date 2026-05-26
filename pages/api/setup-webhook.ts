import { NextApiRequest, NextApiResponse } from "next"
import { runApi } from "../../lib/api-handler"
import { setWebhook, webappUrl } from "../../lib/telegram"

export default runApi(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const secret = req.query.secret
  if (!process.env.SETUP_SECRET || secret !== process.env.SETUP_SECRET) {
    return res.status(401).json({ success: false, error: "Unauthorized" })
  }

  const host =
    process.env.WEBAPP_URL?.replace(/\/webapp\/?$/, "") ||
    "https://nova-hr-employee.vercel.app"

  if (!host) {
    return res.status(400).json({ success: false, error: "Could not determine deployment URL" })
  }

  const webhookUrl = `${host.replace(/\/$/, "")}/api/telegram`
  await setWebhook(webhookUrl)

  res.status(200).json({
    success: true,
    webhook: webhookUrl,
    webapp: webappUrl(),
    message: "Webhook registered. You can stop running hiring_bot.py — Telegram will use Vercel instead.",
  })
})

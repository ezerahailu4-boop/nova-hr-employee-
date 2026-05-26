import { NextApiRequest, NextApiResponse } from "next"
import { runApi } from "../../lib/api-handler"

export default runApi(async (_req: NextApiRequest, res: NextApiResponse) => {
  res.status(200).json({ success: true, status: "ok", time: new Date().toISOString() })
})

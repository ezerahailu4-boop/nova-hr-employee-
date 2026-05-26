import crypto from "crypto"

const AUTH_MAX_AGE_SECONDS = 86400

export function verifyTelegramInitData(initData: string): Record<string, any> | null {
  const BOT_TOKEN = process.env.BOT_TOKEN
  if (!BOT_TOKEN || !initData) return null

  const pairs = new URLSearchParams(initData)
  const receivedHash = pairs.get("hash")
  if (!receivedHash) return null

  pairs.delete("hash")
  const dataCheckString = Array.from(pairs.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")

  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest()
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex")

  const calcBuf = Buffer.from(calculated)
  const recvBuf = Buffer.from(receivedHash)
  if (calcBuf.length !== recvBuf.length || !crypto.timingSafeEqual(calcBuf, recvBuf)) return null

  const authDate = parseInt(pairs.get("auth_date") || "0")
  if (Date.now() / 1000 - authDate > AUTH_MAX_AGE_SECONDS) return null

  try {
    return JSON.parse(pairs.get("user") || "{}")
  } catch {
    return null
  }
}

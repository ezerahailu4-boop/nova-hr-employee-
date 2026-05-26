import { BOT_TOKEN } from "./env"
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : ""

export async function telegramApi(method: string, body: Record<string, unknown>) {
  if (!API_BASE) throw new Error("BOT_TOKEN is not configured")

  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`)
  }
  return data.result
}

import { WEBAPP_URL } from "./env"

export function webappUrl() {
  const url = WEBAPP_URL
  if (!url) return ""
  if (url.startsWith("http")) return url.includes("/webapp") ? url : `${url.replace(/\/$/, "")}/webapp`
  return `https://${url.replace(/\/$/, "")}/webapp`
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return telegramApi("sendMessage", { chat_id: chatId, text, ...extra })
}

export async function forwardFileToAdmin(
  adminChatId: number | string,
  fromChatId: number,
  messageId: number,
  caption: string,
  extra: Record<string, unknown> = {}
) {
  await telegramApi("forwardMessage", {
    chat_id: adminChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  })
  if (caption) {
    await sendMessage(adminChatId, caption, { parse_mode: "Markdown", ...extra })
  }
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return telegramApi("editMessageText", { chat_id: chatId, message_id: messageId, text, ...extra })
}

export async function editMessageReplyMarkup(
  chatId: number | string,
  messageId: number,
  replyMarkup: Record<string, unknown> | null = null
) {
  // When replyMarkup is null the API will remove the inline keyboard
  return telegramApi("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
}

export async function setWebhook(webhookUrl: string) {
  return telegramApi("setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "callback_query"],
  })
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  })
}

export async function setChatMenuButton(chatId: number, url: string) {
  return telegramApi("setChatMenuButton", {
    chat_id: chatId,
    menu_button: {
      type: "web_app",
      text: "Open Careers",
      web_app: { url },
    },
  })
}

import { supabaseAdmin } from "./supabase"
import {
  sendMessage,
  forwardFileToAdmin,
  setChatMenuButton,
  webappUrl,
  answerCallbackQuery,
  editMessageText,
} from "./telegram"
import { ADMIN_CHAT_ID, COMPANY_NAME } from "./env"

// ── Helpers ────────────────────────────────────────────────────────────────

function adminId() {
  const id = parseInt(ADMIN_CHAT_ID || "", 10)
  return Number.isNaN(id) ? null : id
}

function makeSubId(userId: number, suffix: string) {
  return `${Date.now()}${String(userId).slice(-4)}${suffix}`
}

// ── State machine ──────────────────────────────────────────────────────────
// States: idle | awaiting_job_choice | collecting_name | collecting_phone |
//         collecting_email | collecting_age | collecting_gender |
//         collecting_education | collecting_experience | collecting_cover |
//         awaiting_cv | employer_password

async function getState(userId: number): Promise<any> {
  if (!supabaseAdmin) return null
  const { data } = await supabaseAdmin
    .from("conversation_state")
    .select("*")
    .eq("telegram_id", userId)
    .single()
  return data || null
}

async function setState(userId: number, state: string, data: Record<string, any> = {}) {
  if (!supabaseAdmin) return
  await supabaseAdmin.from("conversation_state").upsert({
    telegram_id: userId,
    state,
    data,
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_id" })
}

async function clearState(userId: number) {
  if (!supabaseAdmin) return
  await supabaseAdmin.from("conversation_state").delete().eq("telegram_id", userId)
}

// ── Menu keyboard ──────────────────────────────────────────────────────────

const MAIN_MENU = {
  keyboard: [
    [{ text: "📋 Apply for a Job" }, { text: "📤 Upload CV" }],
    [{ text: "📁 My Applications" }, { text: "ℹ️ About Us" }],
  ],
  resize_keyboard: true,
  persistent: true,
}

// ── Supabase helpers ───────────────────────────────────────────────────────

async function saveSubmission(record: Record<string, unknown>) {
  if (!supabaseAdmin) return
  const { error } = await supabaseAdmin.from("submissions").insert(record)
  if (error) console.error("Supabase insert failed:", error.message)
}

async function findPendingSubmission(telegramId: number) {
  if (!supabaseAdmin) return null
  const { data } = await supabaseAdmin
    .from("submissions")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("status", "pending_cv")
    .order("timestamp", { ascending: false })
    .limit(1)
  return data?.[0] || null
}

async function markCvReceived(subId: string, fileId: string) {
  if (!supabaseAdmin) return
  await supabaseAdmin.from("submissions").update({
    status: "pending",
    cv_path: fileId,
    updated_at: new Date().toISOString(),
  }).eq("id", subId)
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleStart(message: any) {
  const chatId = message.chat.id
  const name = message.from.first_name || "Friend"
  const appUrl = webappUrl()

  if (appUrl) {
    try { await setChatMenuButton(chatId, appUrl) } catch { /* non-fatal */ }
  }

  await clearState(message.from.id)
  await sendMessage(
    chatId,
    `👋 Welcome, *${name}*!\n\n*${COMPANY_NAME}* — Your Career Partner\n\n` +
    `Use the menu below to browse jobs, upload your CV, or check your applications.\n` +
    `You can also tap *Open Careers* above for the full web experience.`,
    { parse_mode: "Markdown", reply_markup: MAIN_MENU }
  )
}

async function handleApplyFlow(message: any) {
  const chatId = message.chat.id
  const userId = message.from.id

  if (!supabaseAdmin) {
    await sendMessage(chatId, "Jobs are not available right now (database not configured).", { reply_markup: MAIN_MENU })
    return
  }

  const { data: jobs, error } = await supabaseAdmin.from("jobs").select("id,title,location,type,salary").order("id")
  if (error || !jobs?.length) {
    await sendMessage(chatId, "No open positions right now. Check back soon!", { reply_markup: MAIN_MENU })
    return
  }

  const lines = ["📖 *Open Positions*\n\nReply with the *number* of the job you want to apply for:\n"]
  jobs.slice(0, 20).forEach((j: any, i: number) => {
    lines.push(`*${i + 1}.* ${j.title}\n   📍 ${j.location} · ${j.type}${j.salary ? ` · ${j.salary}` : ""}`)
  })

  await setState(userId, "awaiting_job_choice", { jobs: jobs.slice(0, 20) })
  await sendMessage(chatId, lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: { remove_keyboard: true },
  })
}

async function handleJobChoice(message: any, state: any) {
  const chatId = message.chat.id
  const userId = message.from.id
  const text = (message.text || "").trim()
  const choice = parseInt(text)
  const jobs = state.data?.jobs || []

  if (isNaN(choice) || choice < 1 || choice > jobs.length) {
    await sendMessage(chatId, `Please reply with a number between 1 and ${jobs.length}.`)
    return
  }

  const job = jobs[choice - 1]
  await setState(userId, "collecting_name", { job })
  await sendMessage(
    chatId,
    `Great choice! You're applying for *${job.title}*.\n\nLet's get your details.\n\n*Step 1/6:* What is your *full name*?`,
    { parse_mode: "Markdown" }
  )
}

async function handleCollecting(message: any, state: any) {
  const chatId = message.chat.id
  const userId = message.from.id
  const text = (message.text || "").trim()
  const step = state.state
  const data = state.data || {}

  if (!text) { await sendMessage(chatId, "Please type a response."); return }

  // Validation
  if (step === "collecting_phone" && !/^[\+\d\s\-\(\)]{7,20}$/.test(text)) {
    await sendMessage(chatId, "Please enter a valid phone number (e.g. +251 911 000000).")
    return
  }
  if (step === "collecting_email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    await sendMessage(chatId, "Please enter a valid email address.")
    return
  }
  if (step === "collecting_age") {
    const age = parseInt(text)
    if (isNaN(age) || age < 16 || age > 80) {
      await sendMessage(chatId, "Please enter a valid age (16–80).")
      return
    }
  }

  // Save field and advance
  const transitions: Record<string, { field: string; next: string; prompt: string }> = {
    collecting_name:       { field: "full_name",   next: "collecting_phone",      prompt: "*Step 2/6:* What is your *phone number*?" },
    collecting_phone:      { field: "phone",        next: "collecting_email",      prompt: "*Step 3/6:* What is your *email address*?" },
    collecting_email:      { field: "email",        next: "collecting_age",        prompt: "*Step 4/6:* How old are you? (age)" },
    collecting_age:        { field: "age",          next: "collecting_education",  prompt: "*Step 5/6:* What is your highest *education level*?\n\nReply with one:\n• PhD / Masters\n• Bachelor's Degree\n• Diploma / TVET\n• High School" },
    collecting_education:  { field: "education",    next: "collecting_experience", prompt: "*Step 6/6:* How many *years of experience* do you have?\n\nReply with one:\n• No Experience\n• Less than 1 year\n• 1 – 3 years\n• 3 – 5 years\n• 5+ years" },
    collecting_experience: { field: "experience",   next: "collecting_cover",      prompt: "Almost done! ✍️\n\nWrite a short *cover letter* (2–4 sentences about yourself and why you're a good fit for this role):" },
    collecting_cover:      { field: "cover_letter", next: "awaiting_cv",           prompt: "✅ *Profile complete!*\n\nFinally, please send your *CV* in this chat.\n\nAccepted formats:\n• PDF document 📄\n• Word document 📝\n• Photo of your CV 📷" },
  }

  const t = transitions[step]
  if (!t) return

  const newData = { ...data, [t.field]: text }
  await setState(userId, t.next, newData)

  if (t.next === "awaiting_cv") {
    // Save submission now (status: pending_cv), wait for file
    const user = message.from
    const subId = makeSubId(userId, "bot")
    await saveSubmission({
      id: subId,
      timestamp: new Date().toISOString(),
      telegram_id: userId,
      telegram_username: user.username || "N/A",
      status: "pending_cv",
      source: "telegram_bot",
      position: newData.job?.title || "Unknown",
      full_name: newData.full_name,
      phone: newData.phone,
      email: newData.email,
      age: newData.age,
      education: newData.education,
      experience: newData.experience,
      cover_letter: newData.cover_letter,
    })
    // Store subId so we can link the CV later
    await setState(userId, "awaiting_cv", { ...newData, sub_id: subId })

    const admin = adminId()
    if (admin) {
      await sendMessage(admin,
        `🔔 *New Application (awaiting CV)*\n\n🆔 \`${subId}\`\n💼 ${newData.job?.title}\n👤 ${newData.full_name}\n📱 ${newData.phone}\n📧 ${newData.email}\n🎓 ${newData.education} · ${newData.experience}\n🤖 @${user.username || userId}`,
        { parse_mode: "Markdown" }
      )
    }
  }

  await sendMessage(chatId, t.prompt, { parse_mode: "Markdown" })
}

async function handleWebAppData(message: any) {
  const user = message.from
  const chatId = message.chat.id
  const userId = user.id

  let payload: Record<string, any>
  try {
    payload = JSON.parse(message.web_app_data.data)
  } catch {
    await sendMessage(chatId, "Sorry, we could not read your submission. Please try again.", { reply_markup: MAIN_MENU })
    return
  }

  const isCvUpload = payload.type === "cv_upload"
  const subId = makeSubId(userId, isCvUpload ? "cu" : "wa")
  const position = payload.position || (isCvUpload ? "Open to opportunities" : "Unknown")

  const submission = {
    id: subId,
    timestamp: new Date().toISOString(),
    telegram_id: userId,
    telegram_username: user.username || "N/A",
    status: "pending_cv",
    source: isCvUpload ? "cv_upload" : "mini_app",
    position,
    full_name: payload.full_name || "",
    phone: payload.phone || "",
    email: payload.email || "",
    age: payload.age || "",
    gender: payload.gender || "",
    education: payload.education || "",
    experience: payload.experience || "",
    cover_letter: payload.cover_letter || payload.bio || "",
    portfolio_links: payload.portfolio_links || [],
  }

  await saveSubmission(submission)

  const admin = adminId()
  if (admin) {
    const links = (submission.portfolio_links as string[]).map((l) => `   • ${l}`).join("\n") || "None"
    const adminText = isCvUpload
      ? `📎 *New CV Upload*\n\n🆔 \`${subId}\`\n👤 ${submission.full_name}\n📱 ${submission.phone}\n📧 ${submission.email}\n💼 ${position}\n🤖 @${submission.telegram_username}`
      : `🔔 *New Application (Mini App)*\n\n🆔 \`${subId}\`\n💼 ${position}\n👤 ${submission.full_name}\n📱 ${submission.phone}\n📧 ${submission.email}\n🤖 @${submission.telegram_username}\n\n✍️ _${submission.cover_letter}_\n\n🔗 ${links}`

    const replyMarkup = {
      inline_keyboard: [[
        { text: "✅ Accept", callback_data: `accept_${subId}` },
        { text: "❌ Reject", callback_data: `reject_${subId}` },
      ]],
    }
    await sendMessage(admin, adminText, { parse_mode: "Markdown", reply_markup: replyMarkup })
  }

  await sendMessage(
    chatId,
    isCvUpload
      ? `✅ *Profile received, ${submission.full_name}!*\n\n📎 Now send your CV in this chat (PDF, Word, or photo).`
      : `🎉 *Application received!*\n\nPosition: *${position}*\n\n📎 Please upload your CV now in this chat.`,
    { parse_mode: "Markdown", reply_markup: MAIN_MENU }
  )
}

async function handleCvFile(message: any) {
  const user = message.from
  const chatId = message.chat.id
  const userId = user.id

  const fileId = message.document?.file_id || message.photo?.[message.photo.length - 1]?.file_id
  if (!fileId) {
    await sendMessage(chatId, "📎 Please send your CV as a PDF, Word document, or photo.")
    return
  }

  // Check conversation state first, then fall back to DB lookup
  const convState = await getState(userId)
  let subId: string | null = null
  let subName = ""
  let subPos = ""

  if (convState?.state === "awaiting_cv") {
    subId = convState.data?.sub_id || null
    subName = convState.data?.full_name || ""
    subPos = convState.data?.job?.title || ""
    await clearState(userId)
  } else {
    const pending = await findPendingSubmission(userId)
    if (pending) {
      subId = pending.id
      subName = pending.full_name || ""
      subPos = pending.position || ""
    }
  }

  if (subId) await markCvReceived(subId, fileId)

  const admin = adminId()
  if (admin) {
    const caption = subId
      ? `📎 CV for \`${subId}\` — ${subName} (${subPos})`
      : `📎 CV from @${user.username || userId} (no linked application)`
    const replyMarkup = subId
      ? { inline_keyboard: [[{ text: "✅ Accept", callback_data: `accept_${subId}` }, { text: "❌ Reject", callback_data: `reject_${subId}` }]] }
      : undefined
    await forwardFileToAdmin(admin, chatId, message.message_id, caption, { reply_markup: replyMarkup })
  }

  await sendMessage(
    chatId,
    "✅ *CV received!* Our team will review your application and contact you soon. Good luck! 🍀",
    { parse_mode: "Markdown", reply_markup: MAIN_MENU }
  )
}

async function handleMyApplications(chatId: number, userId: number) {
  if (!supabaseAdmin) {
    await sendMessage(chatId, "Could not load applications (database not configured).", { reply_markup: MAIN_MENU })
    return
  }
  const { data: subs } = await supabaseAdmin
    .from("submissions")
    .select("status,position,timestamp,interview")
    .eq("telegram_id", userId)
    .order("timestamp", { ascending: false })
    .limit(5)

  if (!subs?.length) {
    await sendMessage(chatId, "You haven't applied yet. Tap *📋 Apply for a Job* to get started.", { parse_mode: "Markdown", reply_markup: MAIN_MENU })
    return
  }

  const rows = subs.map((s: any) => {
    const icon = s.status === "accepted" ? "✅" : s.status === "rejected" ? "❌" : "⏳"
    const interview = s.interview ? `\n   📅 Interview: ${s.interview}` : ""
    return `${icon} *${s.position || "N/A"}*\n   🕒 ${(s.timestamp || "").slice(0, 10)} · ${String(s.status || "pending").toUpperCase()}${interview}`
  })

  await sendMessage(chatId, `📌 *Your Applications*\n\n${rows.join("\n\n")}`, { parse_mode: "Markdown", reply_markup: MAIN_MENU })
}

// ── Main dispatcher ────────────────────────────────────────────────────────

export async function processTelegramUpdate(update: any) {
  // Callback queries (Accept/Reject buttons in admin chat)
  if (update.callback_query) {
    const data = update.callback_query.data || ""
    let action = ""
    let subId = ""
    if (data.startsWith("accept_")) { action = "accept"; subId = data.slice(7) }
    else if (data.startsWith("reject_")) { action = "reject"; subId = data.slice(7) }

    if (subId && action && supabaseAdmin) {
      await supabaseAdmin
        .from("submissions")
        .update({ status: action === "accept" ? "accepted" : "rejected", updated_at: new Date().toISOString() })
        .eq("id", subId)
      await answerCallbackQuery(update.callback_query.id, `${subId} → ${action}ed`)

      try {
        const msg = update.callback_query.message
        if (msg?.message_id && msg?.chat?.id) {
          const statusText = action === "accept" ? "✅ Accepted" : "❌ Rejected"
          const newText = `${(msg.text || "").trim()}\n\n*Status:* ${statusText}`
          await editMessageText(msg.chat.id, msg.message_id, newText, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [] } })
        }
      } catch (err) {
        console.error("Failed to edit admin message:", err)
      }
    }
    return
  }

  const message = update.message
  if (!message) return

  // Mini-app submission
  if (message.web_app_data) {
    await handleWebAppData(message)
    return
  }

  // CV/document upload
  if (message.document || message.photo) {
    await handleCvFile(message)
    return
  }

  const text = (message.text || "").trim()
  const chatId = message.chat.id
  const userId = message.from.id

  // /start
  if (text === "/start" || text.startsWith("/start ")) {
    await handleStart(message)
    return
  }

  // Main menu buttons
  if (text === "📋 Apply for a Job") {
    await handleApplyFlow(message)
    return
  }
  if (text === "📤 Upload CV") {
    await clearState(userId)
    await sendMessage(chatId, "📥 Send your CV now.\n\nAccepted: PDF, Word document, or photo of your CV.", { reply_markup: { remove_keyboard: true } })
    return
  }
  if (text === "📁 My Applications") {
    await handleMyApplications(chatId, userId)
    return
  }
  if (text === "ℹ️ About Us" || text === "ℹ️ About") {
    await sendMessage(
      chatId,
      `🏢 *${COMPANY_NAME}*\n\nNova HR Supply & Management PLC\n\nWe connect businesses with top talent across Ethiopia.\n\n📧 info@novahrsm.com\n📞 +251 990 087 807\n🌐 www.novahrsm.com`,
      { parse_mode: "Markdown", reply_markup: MAIN_MENU }
    )
    return
  }

  // Conversation state machine
  const convState = await getState(userId)
  if (convState) {
    const s = convState.state
    if (s === "awaiting_job_choice") { await handleJobChoice(message, convState); return }
    if (s?.startsWith("collecting_")) { await handleCollecting(message, convState); return }
    if (s === "awaiting_cv") {
      await sendMessage(chatId, "📎 I'm waiting for your CV file. Please send it as a PDF, Word document, or photo.")
      return
    }
  }

  // Unknown input — show menu
  if (text.length > 0) {
    await sendMessage(chatId, "Use the menu below to get started 👇", { reply_markup: MAIN_MENU })
  }
}

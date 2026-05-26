import logging
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client, Client
from telegram import (
    Update, ReplyKeyboardMarkup, ReplyKeyboardRemove,
    KeyboardButton, InlineKeyboardButton, InlineKeyboardMarkup
)
from telegram.error import TelegramError
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    ConversationHandler, CallbackQueryHandler, ContextTypes, filters,
)

load_dotenv()

# ══════════════════════════════════════════════════════════════════════════════
# ── CONFIG
# ══════════════════════════════════════════════════════════════════════════════
BOT_TOKEN         = os.getenv("BOT_TOKEN")
ADMIN_CHAT_ID     = int(os.getenv("ADMIN_CHAT_ID", "0"))
TELEGRAM_CHANNEL  = os.getenv("TELEGRAM_CHANNEL", "@NovaHRsupply")
COMPANY_NAME      = os.getenv("COMPANY_NAME", "Nova HR SM")
COMPANY_EMAIL     = os.getenv("COMPANY_EMAIL", "info@novahrsm.com")
COMPANY_PHONE     = os.getenv("COMPANY_PHONE", "+251 990 087 807")
COMPANY_HOURS     = os.getenv("COMPANY_HOURS", "Mon – Fri, 08:30 – 17:30")
COMPANY_WEBSITE   = os.getenv("COMPANY_WEBSITE", "https://www.novahrsm.com")
COMPANY_ADDRESS   = os.getenv("COMPANY_ADDRESS", "Ethio China Street, TAF Energies Building, Addis Ababa")
SUBMISSIONS_FILE  = os.getenv("SUBMISSIONS_FILE", "submissions.json")
EMPLOYER_PASSWORD = os.getenv("EMPLOYER_PASSWORD", "nova2024")
CV_FOLDER         = os.getenv("CV_FOLDER", "cvs")
RATE_LIMIT        = int(os.getenv("RATE_LIMIT", "3"))
SUPABASE_URL      = os.getenv("SUPABASE_URL", "https://aunkcnmplnunnercrvni.supabase.co")
SUPABASE_KEY      = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_BUCKET   = os.getenv("SUPABASE_BUCKET", "cvs")
WEBAPP_URL        = os.getenv("WEBAPP_URL", "https://nova-hr-employee.vercel.app")

os.makedirs(CV_FOLDER, exist_ok=True)

# Init Supabase
try:
    supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception:
    supabase_client = None

_rate_tracker: dict[int, list] = defaultdict(list)
logging.basicConfig(format="%(asctime)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════════════════════════
# ── STATES
# ══════════════════════════════════════════════════════════════════════════════
(
    MAIN_MENU, CHOOSE_JOB,
    GET_NAME, GET_PHONE, GET_EMAIL, GET_AGE,
    GET_GENDER, GET_EDUCATION, GET_EXPERIENCE,
    GET_COVER_LETTER, GET_PORTFOLIO, GET_CV, CONFIRM,
    POST_JOB_MENU, GET_JOB_TITLE, GET_JOB_DESCRIPTION, GET_JOB_REQUIREMENTS,
    GET_JOB_SALARY, GET_JOB_LOCATION, GET_JOB_TYPE, CONFIRM_JOB_POST,
    CHECK_STATUS,
) = range(22)

# ══════════════════════════════════════════════════════════════════════════════
# ── JOBS
# ══════════════════════════════════════════════════════════════════════════════
JOBS_FILE = "jobs.json"

def load_jobs() -> list:
    # Try Supabase first
    if supabase_client:
        try:
            res = supabase_client.table("jobs").select("*").order("id").execute()
            if res.data:
                return res.data
        except Exception as e:
            logger.error("Supabase jobs load failed: %s", e)
    # Fallback to local file
    if os.path.exists(JOBS_FILE):
        with open(JOBS_FILE, "r", encoding="utf-8-sig") as f:
            jobs = json.load(f)
        for job in jobs:
            job.setdefault("description", "No description provided.")
            job.setdefault("requirements", "No specific requirements.")
            job.setdefault("salary", "Competitive")
            job.setdefault("location", "Addis Ababa, Ethiopia")
            job.setdefault("type", "Full-time")
        return jobs
    return []

JOBS = load_jobs()

# ══════════════════════════════════════════════════════════════════════════════
# ── STORAGE
# ══════════════════════════════════════════════════════════════════════════════
def _write_submissions(subs: list):
    with open(SUBMISSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(subs, f, indent=2, ensure_ascii=False)

def load_submissions() -> list:
    # Try Supabase first
    if supabase_client:
        try:
            res = supabase_client.table("submissions").select("*").order("submitted_at", desc=True).execute()
            if res.data is not None:
                return res.data
        except Exception as e:
            logger.error("Supabase submissions load failed: %s", e)
    if os.path.exists(SUBMISSIONS_FILE):
        with open(SUBMISSIONS_FILE, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    return []

def save_submission(data: dict):
    # Local backup
    try:
        subs = []
        if os.path.exists(SUBMISSIONS_FILE):
            with open(SUBMISSIONS_FILE, "r", encoding="utf-8-sig") as f:
                subs = json.load(f)
        subs.append(data)
        _write_submissions(subs)
    except Exception as e:
        logger.error("Local submission save failed: %s", e)

    # Supabase (primary)
    if supabase_client:
        try:
            row = {
                "id": data["id"],
                "timestamp": data.get("timestamp"),
                "status": data.get("status", "pending"),
                "position": data.get("position"),
                "full_name": data.get("full_name"),
                "phone": data.get("phone"),
                "email": data.get("email"),
                "age": data.get("age"),
                "gender": data.get("gender"),
                "education": data.get("education"),
                "experience": data.get("experience"),
                "cover_letter": data.get("cover_letter"),
                "portfolio_links": data.get("portfolio_links", []),
                "telegram_id": str(data.get("telegram_id", "")),
                "telegram_username": data.get("telegram_username", ""),
                "cv_path": data.get("cv_path", ""),
                "source": data.get("source", "telegram_bot"),
                "submitted_at": data.get("timestamp"),
            }
            supabase_client.table("submissions").upsert(row).execute()
            logger.info("Submission saved to Supabase: %s", data["id"])
        except Exception as e:
            logger.error("Supabase submission save failed: %s", e)

def update_submission_status(sub_id: str, status: str):
    # Update locally
    try:
        if os.path.exists(SUBMISSIONS_FILE):
            with open(SUBMISSIONS_FILE, "r", encoding="utf-8-sig") as f:
                subs = json.load(f)
            for s in subs:
                if s["id"] == sub_id:
                    s["status"] = status
                    break
            _write_submissions(subs)
    except Exception:
        pass
    # Update Supabase
    if supabase_client:
        try:
            supabase_client.table("submissions").update({"status": status}).eq("id", sub_id).execute()
        except Exception as e:
            logger.error("Supabase status update failed: %s", e)

def get_submission(sub_id: str) -> dict | None:
    if supabase_client:
        try:
            res = supabase_client.table("submissions").select("*").eq("id", sub_id).execute()
            if res.data:
                return res.data[0]
        except Exception:
            pass
    return next((s for s in load_submissions() if s["id"] == sub_id), None)

def get_user_submissions(telegram_id: int) -> list:
    if supabase_client:
        try:
            res = supabase_client.table("submissions").select("*").eq("telegram_id", str(telegram_id)).order("submitted_at", desc=True).execute()
            if res.data is not None:
                return res.data
        except Exception as e:
            logger.error("Supabase user subs load failed: %s", e)
    return [s for s in load_submissions() if str(s.get("telegram_id", "")) == str(telegram_id)]

def get_signed_cv_url(cv_path: str) -> str:
    """Generate a signed URL for private Supabase Storage file (valid 1 hour)."""
    if not supabase_client or not cv_path:
        return cv_path
    try:
        filename = cv_path.split(f"/{SUPABASE_BUCKET}/")[-1]
        res = supabase_client.storage.from_(SUPABASE_BUCKET).create_signed_url(filename, 3600)
        return res.get("signedURL") or res.get("signed_url") or cv_path
    except Exception as e:
        logger.error("Signed URL generation failed: %s", e)
        return cv_path

def is_rate_limited(user_id: int) -> bool:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=1)
    _rate_tracker[user_id] = [t for t in _rate_tracker[user_id] if t > cutoff]
    if len(_rate_tracker[user_id]) >= RATE_LIMIT:
        return True
    _rate_tracker[user_id].append(now)
    return False

def has_duplicate(user_id: int, position: str) -> bool:
    subs = get_user_submissions(user_id)
    return any(
        s.get("position") == position and s.get("status") == "pending"
        for s in subs
    )

def is_valid_url(text: str) -> bool:
    return bool(re.match(r'^https?://', text.strip()))

async def download_and_save_cv(bot, cv: dict, sub_id: str) -> str:
    """Download CV from Telegram and upload to Supabase Storage permanently."""
    try:
        file_obj = await bot.get_file(cv["file_id"])
        ext = os.path.splitext(cv.get("file_name", "cv"))[1] if cv["type"] == "document" else ".jpg"
        ext = ext or ".pdf"
        filename = f"{sub_id}{ext}"

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
        await file_obj.download_to_drive(tmp_path)

        if supabase_client:
            mime_map = {
                ".pdf": "application/pdf",
                ".doc": "application/msword",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            }
            mime = mime_map.get(ext.lower(), "application/octet-stream")
            with open(tmp_path, "rb") as f:
                file_bytes = f.read()
            supabase_client.storage.from_(SUPABASE_BUCKET).upload(
                path=filename, file=file_bytes,
                file_options={"content-type": mime, "upsert": "true"},
            )
            os.unlink(tmp_path)
            cv_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{filename}"
            logger.info("CV uploaded to Supabase Storage: %s", cv_url)
            return cv_url
        else:
            fallback = os.path.join(CV_FOLDER, filename)
            os.rename(tmp_path, fallback)
            logger.warning("Supabase not configured, saved locally: %s", fallback)
            return fallback
    except Exception as e:
        logger.error("CV upload failed: %s", e)
        return ""

async def post_cv_to_telegram_channel(bot, submission: dict, cv: dict) -> bool:
    if not BOT_TOKEN or not TELEGRAM_CHANNEL:
        return False
    try:
        cv_url = get_signed_cv_url(submission.get("cv_path", ""))
        caption = (
            f"📎 <b>New Application</b>\n"
            f"👤 {submission.get('full_name', 'Unknown')}\n"
            f"💼 {submission.get('position', 'Open')}\n"
            f"⚧ {submission.get('gender', '—')}\n"
            f"📧 {submission.get('email', '—')}\n"
            f"📱 {submission.get('phone', '—')}\n"
            f"🎓 {submission.get('education', '—')} · {submission.get('experience', '—')}\n"
            f"🔗 @{submission.get('telegram_username', '—')}\n"
            f"📝 ID: <code>{submission.get('id', '?')}</code>"
        )
        if cv_url and cv_url.startswith("http"):
            caption += f"\n\n💾 <a href='{cv_url}'>Download CV</a>"
        if cv.get("type") == "document":
            await bot.send_document(chat_id=TELEGRAM_CHANNEL, document=cv["file_id"], caption=caption, parse_mode="HTML")
        elif cv.get("type") == "photo":
            await bot.send_photo(chat_id=TELEGRAM_CHANNEL, photo=cv["file_id"], caption=caption, parse_mode="HTML")
        logger.info("CV posted to channel: %s", TELEGRAM_CHANNEL)
        return True
    except TelegramError as e:
        logger.error("Failed to post CV to channel: %s", e)
        return False

# ══════════════════════════════════════════════════════════════════════════════
# ── KEYBOARDS
# ══════════════════════════════════════════════════════════════════════════════
def main_menu_kb():
    return ReplyKeyboardMarkup(
        [
            ["📋 View Jobs", "📤 Upload CV"],
            ["📁 My Applications", "ℹ️ About Us"],
        ],
        resize_keyboard=True,
    )

def admin_menu_kb():
    return ReplyKeyboardMarkup(
        [
            ["📋 View Jobs", "📤 Upload CV"],
            ["📁 My Applications", "ℹ️ About Us"],
            ["🏢 Post a Job"],
        ],
        resize_keyboard=True,
    )

def is_admin(update: Update) -> bool:
    return update.effective_user.id == ADMIN_CHAT_ID

def back_kb():
    return ReplyKeyboardMarkup([["🔙 Back"]], resize_keyboard=True)

def gender_kb():
    return ReplyKeyboardMarkup([["👨 Male", "👩 Female"], ["🔙 Back"]], resize_keyboard=True)

def education_kb():
    return ReplyKeyboardMarkup(
        [
            ["🎓 PhD / Masters", "🎓 Bachelor's Degree"],
            ["📜 Diploma / TVET", "📚 High School"],
            ["🔙 Back"],
        ],
        resize_keyboard=True,
    )

def experience_kb():
    return ReplyKeyboardMarkup(
        [
            ["🆕 No Experience", "⏱ Less than 1 year"],
            ["📅 1 – 3 years", "📅 3 – 5 years"],
            ["🏆 5+ years"],
            ["🔙 Back"],
        ],
        resize_keyboard=True,
    )

def confirm_kb():
    return ReplyKeyboardMarkup([["✅ Confirm & Submit", "❌ Cancel"]], resize_keyboard=True)

def portfolio_kb():
    return ReplyKeyboardMarkup([["✅ Done"], ["🔙 Back"]], resize_keyboard=True)

def job_card_inline_kb(job_id: int, bot_username: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("📝 Apply Now", callback_data=f"apply_{job_id}"),
            InlineKeyboardButton("🔍 View Details", callback_data=f"details_{job_id}"),
        ]
    ])

def apply_confirm_inline_kb(job_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Apply for this Job", callback_data=f"apply_{job_id}")],
        [InlineKeyboardButton("🔙 Back to Jobs", callback_data="back_to_jobs")],
    ])

def admin_action_kb(sub_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Accept", callback_data=f"accept_{sub_id}"),
            InlineKeyboardButton("❌ Reject", callback_data=f"reject_{sub_id}"),
        ],
    ])

def status_check_inline_kb(sub_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🔄 Refresh Status", callback_data=f"status_{sub_id}")]
    ])

# ══════════════════════════════════════════════════════════════════════════════
# ── HELPERS
# ══════════════════════════════════════════════════════════════════════════════
async def send_jobs_list(update_or_query, context, is_callback=False):
    jobs = load_jobs()
    JOBS[:] = jobs
    bot_info = await context.bot.get_me()
    bot_username = bot_info.username

    if not jobs:
        text = "😔 No open positions right now. Check back soon!"
        await update_or_query.message.reply_text(text, reply_markup=main_menu_kb())
        return

    header = f"🏢 *Open Positions at {COMPANY_NAME}*\n_{len(jobs)} job(s) available_"
    await update_or_query.message.reply_text(header, parse_mode="Markdown")

    for job in jobs:
        card = (
            f"*{job['title']}*\n"
            f"📍 {job.get('location', 'Addis Ababa')}  •  🕐 {job.get('type', 'Full-time')}\n"
            f"💰 {job.get('salary', 'Competitive')}\n"
            f"📅 Deadline: {job.get('deadline', 'Open')}\n"
        )
        await update_or_query.message.reply_text(
            card,
            parse_mode="Markdown",
            reply_markup=job_card_inline_kb(job["id"], bot_username),
        )

async def show_user_applications(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    subs = get_user_submissions(user_id)
    kb = admin_menu_kb() if is_admin(update) else main_menu_kb()

    if not subs:
        await update.message.reply_text(
            "You haven't submitted any applications yet.\n\nTap *📋 View Jobs* to browse open positions!",
            parse_mode="Markdown",
            reply_markup=kb,
        )
        return

    rows = [f"📁 *Your Applications ({len(subs)} total):*\n"]
    for s in subs[:8]:
        status = s.get("status", "pending")
        icon = {"accepted": "✅", "rejected": "❌", "pending": "⏳"}.get(status, "⏳")
        date = (s.get("submitted_at") or s.get("timestamp") or "")[:10]
        rows.append(
            f"{icon} *{s.get('position', '—')}*\n"
            f"   📅 {date} · `{s.get('id', '?')[:12]}...`\n"
            f"   Status: *{status.upper()}*"
        )

    await update.message.reply_text(
        "\n\n".join(rows),
        parse_mode="Markdown",
        reply_markup=kb,
    )

# ══════════════════════════════════════════════════════════════════════════════
# ── /start
# ══════════════════════════════════════════════════════════════════════════════
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    name = update.effective_user.first_name or "Friend"
    username = update.effective_user.username or ""
    context.user_data["telegram_username"] = username

    args = context.args or []

    # Deep link: apply_<job_id> from webapp or channel
    if args and args[0].startswith("apply_"):
        job_id_str = args[0].replace("apply_", "")
        try:
            job_id = int(job_id_str)
            jobs = load_jobs()
            job = next((j for j in jobs if j["id"] == job_id), None)
            if job:
                context.user_data["position"] = job["title"]
                context.user_data["job_id"] = job_id
                await update.message.reply_text(
                    f"✅ You selected: *{job['title']}*\n\nLet's start your application!\n\n👤 What is your *full name*?",
                    parse_mode="Markdown",
                    reply_markup=back_kb(),
                )
                return GET_NAME
        except ValueError:
            pass

    # Deep link: status_<sub_id>
    if args and args[0].startswith("status_"):
        sub_id = args[0].replace("status_", "")
        sub = get_submission(sub_id)
        if sub:
            status = sub.get("status", "pending")
            icon = {"accepted": "✅", "rejected": "❌", "pending": "⏳"}.get(status, "⏳")
            await update.message.reply_text(
                f"{icon} *Application Status*\n\n"
                f"📝 ID: `{sub_id}`\n"
                f"💼 Position: {sub.get('position', '—')}\n"
                f"Status: *{status.upper()}*",
                parse_mode="Markdown",
                reply_markup=status_check_inline_kb(sub_id),
            )
            return MAIN_MENU

    kb = admin_menu_kb() if is_admin(update) else main_menu_kb()
    await update.message.reply_text(
        f"👋 Welcome, *{name}*!\n\n"
        f"*{COMPANY_NAME}*\n"
        f"_Nova HR Supply & Management PLC_\n\n"
        "We connect top talent with leading organizations across Ethiopia.\n\n"
        "What would you like to do today?",
        parse_mode="Markdown",
        reply_markup=kb,
    )
    return MAIN_MENU

# ══════════════════════════════════════════════════════════════════════════════
# ── INLINE BUTTON HANDLER
# ══════════════════════════════════════════════════════════════════════════════
async def inline_button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    jobs = load_jobs()
    JOBS[:] = jobs

    # Apply for a job
    if data.startswith("apply_"):
        job_id = int(data.replace("apply_", ""))
        job = next((j for j in jobs if j["id"] == job_id), None)
        if not job:
            await query.message.reply_text("⚠️ This job is no longer available.", reply_markup=main_menu_kb())
            return MAIN_MENU
        context.user_data["position"] = job["title"]
        context.user_data["job_id"] = job_id
        username = query.from_user.username or ""
        context.user_data["telegram_username"] = username
        await query.message.reply_text(
            f"✅ Applying for *{job['title']}*\n\n👤 What is your *full name*?",
            parse_mode="Markdown",
            reply_markup=back_kb(),
        )
        return GET_NAME

    # View job details
    elif data.startswith("details_"):
        job_id = int(data.replace("details_", ""))
        job = next((j for j in jobs if j["id"] == job_id), None)
        if not job:
            await query.message.reply_text("⚠️ Job not found.")
            return MAIN_MENU
        reqs = job.get("requirements", [])
        reqs_text = "\n".join(f"  • {r}" for r in reqs) if isinstance(reqs, list) else f"  {reqs}"
        detail_text = (
            f"📌 *{job['title']}*\n\n"
            f"🏢 *Company:* {job.get('company', COMPANY_NAME)}\n"
            f"📍 *Location:* {job.get('location', 'Addis Ababa')}\n"
            f"🕐 *Type:* {job.get('type', 'Full-time')}\n"
            f"💰 *Salary:* {job.get('salary', 'Competitive')}\n"
            f"📅 *Deadline:* {job.get('deadline', 'Open')}\n\n"
            f"📝 *Description:*\n{job.get('description', 'No description provided.')}\n\n"
            f"✅ *Requirements:*\n{reqs_text}"
        )
        await query.message.reply_text(
            detail_text, parse_mode="Markdown",
            reply_markup=apply_confirm_inline_kb(job_id),
        )
        return MAIN_MENU

    # Back to jobs list
    elif data == "back_to_jobs":
        await send_jobs_list(query, context, is_callback=True)
        return MAIN_MENU

    # Check application status (inline refresh)
    elif data.startswith("status_"):
        sub_id = data.replace("status_", "")
        sub = get_submission(sub_id)
        if not sub:
            await query.message.reply_text("⚠️ Application not found.")
            return MAIN_MENU
        status = sub.get("status", "pending")
        icon = {"accepted": "✅", "rejected": "❌", "pending": "⏳"}.get(status, "⏳")
        await query.message.edit_text(
            f"{icon} *Application Status*\n\n"
            f"📝 ID: `{sub_id}`\n"
            f"💼 Position: {sub.get('position', '—')}\n"
            f"Status: *{status.upper()}*\n\n"
            f"_Last checked: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC_",
            parse_mode="Markdown",
            reply_markup=status_check_inline_kb(sub_id),
        )
        return MAIN_MENU

    # Admin: Accept
    elif data.startswith("accept_"):
        sub_id = data.replace("accept_", "")
        sub = get_submission(sub_id)
        if not sub:
            await query.message.reply_text("Submission not found.")
            return MAIN_MENU
        update_submission_status(sub_id, "accepted")
        await query.message.edit_reply_markup(reply_markup=None)
        await query.message.reply_text(f"✅ Application `{sub_id}` *accepted*.", parse_mode="Markdown")
        try:
            tg_id = sub.get("telegram_id")
            if tg_id:
                bot_info = await context.bot.get_me()
                status_link = f"https://t.me/{bot_info.username}?start=status_{sub_id}"
                await context.bot.send_message(
                    chat_id=int(tg_id),
                    text=(
                        f"🎉 *Congratulations, {sub.get('full_name')}!*\n\n"
                        f"Your application for *{sub.get('position')}* has been *accepted* by {COMPANY_NAME}!\n\n"
                        "Our team will contact you soon with next steps. 🙌\n\n"
                        f"[Check your application status]({status_link})"
                    ),
                    parse_mode="Markdown",
                )
        except Exception as e:
            logger.error("Could not notify applicant: %s", e)
        return MAIN_MENU

    # Admin: Reject
    elif data.startswith("reject_"):
        sub_id = data.replace("reject_", "")
        sub = get_submission(sub_id)
        if not sub:
            await query.message.reply_text("Submission not found.")
            return MAIN_MENU
        update_submission_status(sub_id, "rejected")
        await query.message.edit_reply_markup(reply_markup=None)
        await query.message.reply_text(f"❌ Application `{sub_id}` *rejected*.", parse_mode="Markdown")
        try:
            tg_id = sub.get("telegram_id")
            if tg_id:
                await context.bot.send_message(
                    chat_id=int(tg_id),
                    text=(
                        f"Thank you for applying to {COMPANY_NAME}, {sub.get('full_name')}.\n\n"
                        f"After careful review, we regret that your application for *{sub.get('position')}* "
                        "was not selected at this time.\n\n"
                        "We encourage you to apply for future openings. Good luck! 🙏"
                    ),
                    parse_mode="Markdown",
                )
        except Exception as e:
            logger.error("Could not notify applicant: %s", e)
        return MAIN_MENU

    return MAIN_MENU

# ══════════════════════════════════════════════════════════════════════════════
# ── MAIN MENU
# ══════════════════════════════════════════════════════════════════════════════
async def main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    # Save username on every message
    context.user_data["telegram_username"] = update.effective_user.username or ""

    if text == "📋 View Jobs":
        await send_jobs_list(update, context)
        return MAIN_MENU

    elif text == "📤 Upload CV":
        await update.message.reply_text(
            "📎 Please send your CV now.\n\nAccepted: PDF, Word doc, or photo of your CV.",
            reply_markup=back_kb(),
        )
        context.user_data["cv_only"] = True
        return GET_CV

    elif text == "📁 My Applications":
        await show_user_applications(update, context)
        return MAIN_MENU

    elif text == "ℹ️ About Us":
        await update.message.reply_text(
            f"🏢 *{COMPANY_NAME}*\n_Nova HR Supply & Management PLC_\n\n"
            "Ethiopia's trusted HR consulting and workforce solutions company.\n\n"
            "📌 *Our Services:*\n"
            "• Talent Sourcing & Recruitment\n"
            "• HR Outsourcing & Workforce Management\n"
            "• Training & Development\n"
            "• Payroll Management\n"
            "• Manpower Supply\n"
            "• HR Consulting & Legal Compliance\n\n"
            f"📧 {COMPANY_EMAIL}\n📱 {COMPANY_PHONE}\n🕐 {COMPANY_HOURS}\n"
            f"🌐 {COMPANY_WEBSITE}\n📍 {COMPANY_ADDRESS}",
            parse_mode="Markdown",
            reply_markup=admin_menu_kb() if is_admin(update) else main_menu_kb(),
        )
        return MAIN_MENU

    elif text == "🏢 Post a Job":
        if not is_admin(update):
            await update.message.reply_text("⛔ This option is not available.", reply_markup=main_menu_kb())
            return MAIN_MENU
        await update.message.reply_text(
            "🔐 *Post a New Job*\n\nWhat is the *job title*?",
            parse_mode="Markdown",
            reply_markup=back_kb(),
        )
        return GET_JOB_TITLE

    else:
        await update.message.reply_text("Please choose an option from the menu below.", reply_markup=admin_menu_kb() if is_admin(update) else main_menu_kb())
        return MAIN_MENU

# ══════════════════════════════════════════════════════════════════════════════
# ── POST JOB FLOW
# ══════════════════════════════════════════════════════════════════════════════
async def get_job_title(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What would you like to do?", reply_markup=admin_menu_kb())
        return MAIN_MENU
    title = update.message.text.strip()
    if len(title) < 3:
        await update.message.reply_text("Please enter a valid job title.", reply_markup=back_kb())
        return GET_JOB_TITLE
    context.user_data["job_title"] = title
    await update.message.reply_text("📝 Job *description*?", parse_mode="Markdown", reply_markup=back_kb())
    return GET_JOB_DESCRIPTION

async def get_job_description(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is the job title?", reply_markup=back_kb())
        return GET_JOB_TITLE
    context.user_data["job_description"] = update.message.text.strip()
    await update.message.reply_text("📋 *Requirements*?", parse_mode="Markdown", reply_markup=back_kb())
    return GET_JOB_REQUIREMENTS

async def get_job_requirements(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is the description?", reply_markup=back_kb())
        return GET_JOB_DESCRIPTION
    context.user_data["job_requirements"] = update.message.text.strip()
    await update.message.reply_text("💰 *Salary range*?\ne.g. 15,000 – 25,000 ETB/month", parse_mode="Markdown", reply_markup=back_kb())
    return GET_JOB_SALARY

async def get_job_salary(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What are the requirements?", reply_markup=back_kb())
        return GET_JOB_REQUIREMENTS
    context.user_data["job_salary"] = update.message.text.strip()
    await update.message.reply_text("📍 *Location*?\ne.g. Addis Ababa, Ethiopia", parse_mode="Markdown", reply_markup=back_kb())
    return GET_JOB_LOCATION

async def get_job_location(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is the salary?", reply_markup=back_kb())
        return GET_JOB_SALARY
    context.user_data["job_location"] = update.message.text.strip()
    await update.message.reply_text(
        "🏷 *Job type*?",
        parse_mode="Markdown",
        reply_markup=ReplyKeyboardMarkup(
            [["Full-time", "Part-time"], ["Contract", "Freelance"], ["🔙 Back"]],
            resize_keyboard=True,
        ),
    )
    return GET_JOB_TYPE

async def get_job_type(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is the location?", reply_markup=back_kb())
        return GET_JOB_LOCATION
    context.user_data["job_type"] = update.message.text.strip()
    summary = (
        f"🏢 *Summary*\n\n"
        f"📌 *Title:* {context.user_data['job_title']}\n"
        f"💰 *Salary:* {context.user_data['job_salary']}\n"
        f"📍 *Location:* {context.user_data['job_location']}\n"
        f"🏷 *Type:* {context.user_data['job_type']}\n\nIs this correct?"
    )
    await update.message.reply_text(summary, parse_mode="Markdown", reply_markup=confirm_kb())
    return CONFIRM_JOB_POST

async def confirm_job_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if text == "❌ Cancel":
        context.user_data.clear()
        await update.message.reply_text("Cancelled.", reply_markup=admin_menu_kb())
        return MAIN_MENU
    if text != "✅ Confirm & Submit":
        await update.message.reply_text("Please confirm or cancel.", reply_markup=confirm_kb())
        return CONFIRM_JOB_POST

    jobs = load_jobs()
    new_id = max([j.get("id", 0) for j in jobs], default=0) + 1
    new_job = {
        "id": new_id,
        "title": context.user_data["job_title"],
        "description": context.user_data["job_description"],
        "requirements": context.user_data["job_requirements"],
        "salary": context.user_data["job_salary"],
        "location": context.user_data["job_location"],
        "type": context.user_data["job_type"],
        "company": COMPANY_NAME,
        "deadline": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "posted_by": update.effective_user.id,
    }

    # Save to Supabase jobs table
    if supabase_client:
        try:
            supabase_client.table("jobs").insert(new_job).execute()
        except Exception as e:
            logger.error("Supabase job save failed: %s", e)

    # Save to local file
    jobs.append(new_job)
    with open(JOBS_FILE, "w", encoding="utf-8") as f:
        json.dump(jobs, f, indent=2, ensure_ascii=False)

    # Post to Telegram channel with Apply button deep link
    if TELEGRAM_CHANNEL:
        try:
            bot_info = await context.bot.get_me()
            apply_url = f"https://t.me/{bot_info.username}?start=apply_{new_id}"
            webapp_url = f"{WEBAPP_URL}?job={new_id}"
            job_text = (
                f"🆕 *{new_job['title']}*\n\n"
                f"{new_job['description'][:300]}{'...' if len(new_job['description']) > 300 else ''}\n\n"
                f"💰 {new_job['salary']}\n"
                f"📍 {new_job['location']}\n"
                f"🏷 {new_job['type']}\n"
                f"📅 Apply by: {new_job['deadline']}"
            )
            channel_kb = InlineKeyboardMarkup([
                [InlineKeyboardButton("📝 Apply via Bot", url=apply_url)],
                [InlineKeyboardButton("🌐 View on Website", url=webapp_url)],
            ])
            await context.bot.send_message(
                chat_id=TELEGRAM_CHANNEL,
                text=job_text,
                parse_mode="Markdown",
                reply_markup=channel_kb,
            )
        except Exception as e:
            logger.error("Failed to post job to channel: %s", e)

    JOBS[:] = load_jobs()
    await update.message.reply_text("✅ *Job posted successfully!*", parse_mode="Markdown", reply_markup=admin_menu_kb())
    context.user_data.clear()
    return MAIN_MENU

# ══════════════════════════════════════════════════════════════════════════════
# ── APPLICATION FLOW
# ══════════════════════════════════════════════════════════════════════════════
async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await send_jobs_list(update, context)
        return MAIN_MENU
    name = update.message.text.strip()
    if len(name) < 2:
        await update.message.reply_text("Please enter your full name.", reply_markup=back_kb())
        return GET_NAME
    context.user_data["full_name"] = name
    await update.message.reply_text(
        f"Nice to meet you, *{name}*! 👋\n\n📱 Your *phone number*?\n_(e.g. +251 911 000000)_",
        parse_mode="Markdown", reply_markup=back_kb(),
    )
    return GET_PHONE

async def get_phone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is your full name?", reply_markup=back_kb())
        return GET_NAME
    phone = update.message.text.strip()
    if len(phone.replace(" ", "").replace("+", "").replace("-", "")) < 9:
        await update.message.reply_text("Please enter a valid phone number.", reply_markup=back_kb())
        return GET_PHONE
    context.user_data["phone"] = phone
    await update.message.reply_text("📧 Your *email address*?", parse_mode="Markdown", reply_markup=back_kb())
    return GET_EMAIL

async def get_email(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is your phone number?", reply_markup=back_kb())
        return GET_PHONE
    email = update.message.text.strip()
    if "@" not in email or "." not in email:
        await update.message.reply_text("Please enter a valid email address.", reply_markup=back_kb())
        return GET_EMAIL
    context.user_data["email"] = email
    await update.message.reply_text("🎂 Your *age*?", parse_mode="Markdown", reply_markup=back_kb())
    return GET_AGE

async def get_age(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is your email?", reply_markup=back_kb())
        return GET_EMAIL
    age = update.message.text.strip()
    if not age.isdigit() or not (16 <= int(age) <= 70):
        await update.message.reply_text("Please enter a valid age (16–70).", reply_markup=back_kb())
        return GET_AGE
    context.user_data["age"] = age
    await update.message.reply_text("⚧ Your *gender*?", parse_mode="Markdown", reply_markup=gender_kb())
    return GET_GENDER

async def get_gender(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("How old are you?", reply_markup=back_kb())
        return GET_AGE
    text = update.message.text
    if text not in ["👨 Male", "👩 Female"]:
        await update.message.reply_text("Please select your gender using the buttons.", reply_markup=gender_kb())
        return GET_GENDER
    context.user_data["gender"] = "Male" if "Male" in text else "Female"
    await update.message.reply_text("🎓 Highest *education level*?", parse_mode="Markdown", reply_markup=education_kb())
    return GET_EDUCATION

async def get_education(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is your gender?", reply_markup=gender_kb())
        return GET_GENDER
    edu_map = {
        "🎓 PhD / Masters": "PhD / Masters",
        "🎓 Bachelor's Degree": "Bachelor's Degree",
        "📜 Diploma / TVET": "Diploma / TVET",
        "📚 High School": "High School",
    }
    if update.message.text not in edu_map:
        await update.message.reply_text("Please select your education using the buttons.", reply_markup=education_kb())
        return GET_EDUCATION
    context.user_data["education"] = edu_map[update.message.text]
    await update.message.reply_text("📊 Years of *experience*?", parse_mode="Markdown", reply_markup=experience_kb())
    return GET_EXPERIENCE

async def get_experience(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("What is your education level?", reply_markup=education_kb())
        return GET_EDUCATION
    exp_map = {
        "🆕 No Experience": "No Experience",
        "⏱ Less than 1 year": "Less than 1 year",
        "📅 1 – 3 years": "1 – 3 years",
        "📅 3 – 5 years": "3 – 5 years",
        "🏆 5+ years": "5+ years",
    }
    if update.message.text not in exp_map:
        await update.message.reply_text("Please select your experience using the buttons.", reply_markup=experience_kb())
        return GET_EXPERIENCE
    context.user_data["experience"] = exp_map[update.message.text]
    await update.message.reply_text(
        "✍️ *Cover Letter / Bio*\n\nWrite a short description about yourself and why you're a good fit.",
        parse_mode="Markdown", reply_markup=back_kb(),
    )
    return GET_COVER_LETTER

async def get_cover_letter(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "🔙 Back":
        await update.message.reply_text("How many years of experience?", reply_markup=experience_kb())
        return GET_EXPERIENCE
    bio = update.message.text.strip()
    if len(bio) < 10:
        await update.message.reply_text("Please write at least a couple sentences.", reply_markup=back_kb())
        return GET_COVER_LETTER
    context.user_data["cover_letter"] = bio
    context.user_data["portfolio_links"] = []
    await update.message.reply_text(
        "🔗 *Portfolio Links* _(optional)_\n\nSend LinkedIn, GitHub, or portfolio links one at a time.\nTap *Done* when finished.",
        parse_mode="Markdown", reply_markup=portfolio_kb(),
    )
    return GET_PORTFOLIO

async def get_portfolio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    if text == "🔙 Back":
        context.user_data["portfolio_links"] = []
        await update.message.reply_text("Please write your cover letter:", reply_markup=back_kb())
        return GET_COVER_LETTER
    if text == "✅ Done":
        await update.message.reply_text(
            "📎 Please upload your *CV* now.\n\nAccepted: PDF, Word doc, or photo.\n\n_No CV? Type_ `No CV` _to skip._",
            parse_mode="Markdown", reply_markup=back_kb(),
        )
        return GET_CV
    if not is_valid_url(text):
        await update.message.reply_text("Please send a valid URL or tap *Done*.", parse_mode="Markdown", reply_markup=portfolio_kb())
        return GET_PORTFOLIO
    links = context.user_data.setdefault("portfolio_links", [])
    links.append(text)
    await update.message.reply_text(f"✅ Link {len(links)} saved! Add more or tap *Done*.", parse_mode="Markdown", reply_markup=portfolio_kb())
    return GET_PORTFOLIO

# ══════════════════════════════════════════════════════════════════════════════
# ── CV UPLOAD
# ══════════════════════════════════════════════════════════════════════════════
async def get_cv(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text and update.message.text == "🔙 Back":
        if context.user_data.get("cv_only"):
            context.user_data.pop("cv_only", None)
            await update.message.reply_text("What would you like to do?", reply_markup=main_menu_kb())
            return MAIN_MENU
        await update.message.reply_text("Please send portfolio links or tap *Done*:", parse_mode="Markdown", reply_markup=portfolio_kb())
        return GET_PORTFOLIO

    if update.message.document:
        doc = update.message.document
        context.user_data["cv"] = {"type": "document", "file_id": doc.file_id, "file_name": doc.file_name}
    elif update.message.photo:
        context.user_data["cv"] = {"type": "photo", "file_id": update.message.photo[-1].file_id}
    elif update.message.text:
        context.user_data["cv"] = {"type": "text", "note": update.message.text}
    else:
        await update.message.reply_text("Please send a document, photo, or type 'No CV'.")
        return GET_CV

    # CV-only upload
    if context.user_data.get("cv_only"):
        context.user_data.pop("cv_only", None)
        cv = context.user_data.get("cv", {})
        user = update.effective_user
        sub_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + str(user.id)[-4:] + "cv"
        local_path = ""
        if cv.get("type") in ("document", "photo"):
            local_path = await download_and_save_cv(context.bot, cv, sub_id)
        sub_data = {
            "id": sub_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "telegram_id": user.id,
            "telegram_username": user.username or "",
            "status": "pending",
            "position": "CV Upload (standalone)",
            "full_name": user.first_name,
            "cv": cv,
            "cv_path": local_path,
            "source": "telegram_bot",
        }
        save_submission(sub_data)
        await update.message.reply_text("✅ CV received! Thank you.", reply_markup=main_menu_kb())
        if cv.get("type") in ("document", "photo"):
            try:
                await post_cv_to_telegram_channel(context.bot, sub_data, cv)
            except Exception as e:
                logger.error("Channel posting error: %s", e)
        return MAIN_MENU

    # Full application — show summary
    d = context.user_data
    cv = d.get("cv", {})
    cv_status = "Uploaded ✅" if cv.get("type") in ("document", "photo") else cv.get("note", "Not provided")
    links = d.get("portfolio_links", [])
    summary = (
        "📋 *Please confirm your application:*\n\n"
        f"💼 *Position:* {d.get('position')}\n"
        f"👤 *Name:* {d.get('full_name')}\n"
        f"📱 *Phone:* {d.get('phone')}\n"
        f"📧 *Email:* {d.get('email')}\n"
        f"🎂 *Age:* {d.get('age')}\n"
        f"⚧ *Gender:* {d.get('gender')}\n"
        f"🎓 *Education:* {d.get('education')}\n"
        f"📊 *Experience:* {d.get('experience')}\n"
        f"✍️ *Bio:* _{d.get('cover_letter', '')[:80]}{'…' if len(d.get('cover_letter',''))>80 else ''}_\n"
        f"🔗 *Portfolio:* {len(links)} link(s)\n"
        f"📄 *CV:* {cv_status}\n"
        f"🔗 *Telegram:* @{d.get('telegram_username', '—')}"
    )
    await update.message.reply_text(summary, parse_mode="Markdown", reply_markup=confirm_kb())
    return CONFIRM

# ══════════════════════════════════════════════════════════════════════════════
# ── CONFIRM & SUBMIT
# ══════════════════════════════════════════════════════════════════════════════
async def confirm_submission(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if text == "❌ Cancel":
        context.user_data.clear()
        await update.message.reply_text("❌ Application cancelled.", reply_markup=main_menu_kb())
        return MAIN_MENU
    if text != "✅ Confirm & Submit":
        await update.message.reply_text("Please tap *Confirm & Submit* or *Cancel*.", parse_mode="Markdown", reply_markup=confirm_kb())
        return CONFIRM

    d = context.user_data
    user_id = update.effective_user.id

    if is_rate_limited(user_id):
        await update.message.reply_text("⚠️ Too many applications recently. Please wait an hour.", reply_markup=main_menu_kb())
        return MAIN_MENU

    if has_duplicate(user_id, d.get("position")):
        await update.message.reply_text(
            f"⚠️ You already have a pending application for *{d.get('position')}*.",
            parse_mode="Markdown", reply_markup=main_menu_kb(),
        )
        return MAIN_MENU

    sub_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + str(user_id)[-4:]
    cv = d.get("cv", {})
    local_path = ""
    if cv.get("type") in ("document", "photo"):
        local_path = await download_and_save_cv(context.bot, cv, sub_id)

    submission = {
        "id": sub_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "telegram_id": user_id,
        "telegram_username": update.effective_user.username or "",
        "status": "pending",
        "position": d.get("position"),
        "full_name": d.get("full_name"),
        "phone": d.get("phone"),
        "email": d.get("email"),
        "age": d.get("age"),
        "gender": d.get("gender"),
        "education": d.get("education"),
        "experience": d.get("experience"),
        "cover_letter": d.get("cover_letter", ""),
        "portfolio_links": d.get("portfolio_links", []),
        "cv": cv,
        "cv_path": local_path,
        "source": "telegram_bot",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    save_submission(submission)

    bot_info = await context.bot.get_me()
    status_link = f"https://t.me/{bot_info.username}?start=status_{sub_id}"

    await update.message.reply_text(
        f"🎉 *Application submitted successfully!*\n\n"
        f"📝 *Application ID:* `{sub_id}`\n"
        f"💼 *Position:* {d.get('position')}\n\n"
        "Our team will review and get back to you soon. 🙌\n\n"
        f"[📊 Check your application status]({status_link})",
        parse_mode="Markdown",
        reply_markup=main_menu_kb(),
    )

    # Post to channel
    if cv.get("type") in ("document", "photo"):
        try:
            await post_cv_to_telegram_channel(context.bot, submission, cv)
        except Exception as e:
            logger.error("Channel posting error: %s", e)

    # Notify admin with signed CV download link
    if ADMIN_CHAT_ID:
        cv_url = get_signed_cv_url(local_path)
        links_text = "\n".join(f" • {l}" for l in submission["portfolio_links"]) or "None"
        admin_text = (
            f"🔔 *New Application!*\n\n"
            f"👤 *{submission['full_name']}* (@{submission['telegram_username']})\n"
            f"💼 {submission['position']}\n"
            f"📧 {submission['email']} · 📱 {submission['phone']}\n"
            f"⚧ {submission['gender']} · 🎂 Age {submission['age']}\n"
            f"🎓 {submission['education']} · {submission['experience']}\n"
            f"🔗 Portfolio: {links_text}\n\n"
            f"✍️ _{submission['cover_letter'][:200]}_\n\n"
            f"📝 ID: `{sub_id}`\n"
            + (f"💾 [Download CV]({cv_url})\n" if cv_url and cv_url.startswith("http") else "")
        )
        try:
            await context.bot.send_message(
                chat_id=ADMIN_CHAT_ID,
                text=admin_text,
                parse_mode="Markdown",
                reply_markup=admin_action_kb(sub_id),
            )
            if cv.get("type") == "document":
                await context.bot.send_document(ADMIN_CHAT_ID, cv["file_id"], caption=f"📄 CV — {submission['full_name']}")
            elif cv.get("type") == "photo":
                await context.bot.send_photo(ADMIN_CHAT_ID, cv["file_id"], caption=f"📷 CV — {submission['full_name']}")
        except Exception as e:
            logger.error("Admin notify failed: %s", e)

    context.user_data.clear()
    return MAIN_MENU

# ══════════════════════════════════════════════════════════════════════════════
# ── /admin & /cancel
# ══════════════════════════════════════════════════════════════════════════════
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("⛔ You are not authorized.")
        return MAIN_MENU
    await update.message.reply_text(
        "🔐 *Admin Panel* — Welcome back!",
        parse_mode="Markdown",
        reply_markup=admin_menu_kb(),
    )
    return MAIN_MENU

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    kb = admin_menu_kb() if is_admin(update) else main_menu_kb()
    await update.message.reply_text("👋 Cancelled.", reply_markup=kb)
    return MAIN_MENU

# ══════════════════════════════════════════════════════════════════════════════
# ── MAIN
# ══════════════════════════════════════════════════════════════════════════════
def main():
    if not BOT_TOKEN:
        raise ValueError("BOT_TOKEN is not set.")

    app = Application.builder().token(BOT_TOKEN).build()

    conv = ConversationHandler(
        entry_points=[
            CommandHandler("start", start),
            CommandHandler("admin", admin_command),
            CallbackQueryHandler(inline_button_handler, pattern=r"^apply_\d+$"),
        ],
        states={
            MAIN_MENU: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, main_menu),
                CallbackQueryHandler(inline_button_handler),
            ],
            CHOOSE_JOB: [MessageHandler(filters.TEXT & ~filters.COMMAND, main_menu)],
            POST_JOB_MENU: [MessageHandler(filters.TEXT & ~filters.COMMAND, main_menu)],
            GET_JOB_TITLE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_job_title)],
            GET_JOB_DESCRIPTION: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_job_description)],
            GET_JOB_REQUIREMENTS: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_job_requirements)],
            GET_JOB_SALARY: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_job_salary)],
            GET_JOB_LOCATION: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_job_location)],
            GET_JOB_TYPE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_job_type)],
            CONFIRM_JOB_POST: [MessageHandler(filters.TEXT & ~filters.COMMAND, confirm_job_post)],
            GET_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
            GET_PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_phone)],
            GET_EMAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_email)],
            GET_AGE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_age)],
            GET_GENDER: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_gender)],
            GET_EDUCATION: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_education)],
            GET_EXPERIENCE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_experience)],
            GET_COVER_LETTER: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_cover_letter)],
            GET_PORTFOLIO: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_portfolio)],
            GET_CV: [
                MessageHandler(filters.Document.ALL, get_cv),
                MessageHandler(filters.PHOTO, get_cv),
                MessageHandler(filters.TEXT & ~filters.COMMAND, get_cv),
            ],
            CONFIRM: [MessageHandler(filters.TEXT & ~filters.COMMAND, confirm_submission)],
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            CommandHandler("admin", admin_command),
        ],
        allow_reentry=True,
    )

    app.add_handler(conv)
    app.add_handler(CallbackQueryHandler(inline_button_handler))

    logger.info("🤖 Nova HR Bot running...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
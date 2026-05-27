$file = "C:\Users\SMC\Downloads\nova-hr-complete\nova-hr-employee-\hiring_bot.py"
$content = Get-Content $file -Raw

# 1. Add supabase import after 'from dotenv import load_dotenv'
$content = $content -replace 'from dotenv import load_dotenv', 'from dotenv import load_dotenv
import tempfile
from supabase import create_client, Client'

# 2. Add Supabase config after RATE_LIMIT line
$content = $content -replace "(RATE_LIMIT\s+=\s+int\(os\.getenv\(""RATE_LIMIT"", ""3""\)\))", '$1
SUPABASE_URL     = os.getenv("SUPABASE_URL", "https://aunkcnmplnunnercrvni.supabase.co")
SUPABASE_KEY     = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_BUCKET  = os.getenv("SUPABASE_BUCKET", "cvs")

# Init Supabase client
try:
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception:
    supabase_client = None'

# 3. Replace download_and_save_cv function
$old_cv = @'
async def download_and_save_cv(bot, cv: dict, sub_id: str) -> str:
    try:
        file_obj = await bot.get_file(cv["file_id"])
        if cv["type"] == "document":
            ext = os.path.splitext(cv.get("file_name", "cv"))[1] or ".pdf"
        else:
            ext = ".jpg"
        filename = f"{sub_id}{ext}"
        filepath = os.path.join(CV_FOLDER, filename)
        await file_obj.download_to_drive(filepath)
        logger.info("CV saved: %s", filepath)
        return filepath
    except Exception as e:
        logger.error("CV download failed: %s", e)
        return ""
'@

$new_cv = @'
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
'@

$content = $content.Replace($old_cv, $new_cv)

# 4. Replace save_submission to also save to Supabase table
$old_save = @'
def save_submission(data: dict):
    subs = load_submissions()
    subs.append(data)
    _write_submissions(subs)
'@

$new_save = @'
def save_submission(data: dict):
    subs = load_submissions()
    subs.append(data)
    _write_submissions(subs)
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
                "telegram_id": data.get("telegram_id"),
                "telegram_username": data.get("telegram_username"),
                "cv_path": data.get("cv_path", ""),
                "source": "telegram_bot",
                "submitted_at": data.get("timestamp"),
            }
            supabase_client.table("submissions").upsert(row).execute()
            logger.info("Submission saved to Supabase: %s", data["id"])
        except Exception as e:
            logger.error("Supabase submission save failed: %s", e)
'@

$content = $content.Replace($old_save, $new_save)

Set-Content $file $content -NoNewline
Write-Host "✅ Patch applied successfully!"
Write-Host ""
Write-Host "Verifying changes..."
Select-String -Path $file -Pattern "supabase_client|SUPABASE_URL|download_to_drive" | Select-Object LineNumber, Line

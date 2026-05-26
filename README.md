# Nova HR SM — Full Stack Hiring Bot

A complete HR hiring platform with:
- **Telegram Bot** — multi-step job application flow with state machine
- **Web App** (Telegram Mini App) — browse jobs, apply, upload CV, track applications
- **Admin Panel** — manage applications, CV files, jobs; accept/reject with one click
- **Supabase** — database + file storage for CVs
- **Vercel** — serverless Next.js deployment

## Live URLs
- Web App: `https://nova-hr-employee.vercel.app/webapp`
- Admin:   `https://nova-hr-employee.vercel.app/admin`
- API:     `https://nova-hr-employee.vercel.app/api/health`

## Setup — 3 steps

### 1. Set environment variables on Vercel

Go to **Vercel → nova-hr-employee → Settings → Environment Variables** and add:

| Variable | Value | Where to get it |
|---|---|---|
| `BOT_TOKEN` | `123456:ABC...` | [@BotFather](https://t.me/BotFather) → `/mybots` → your bot → API Token |
| `ADMIN_CHAT_ID` | `123456789` | Message [@userinfobot](https://t.me/userinfobot) — it replies with your ID |
| `ADMIN_PASSWORD` | any strong password | You choose — this is your admin panel login |
| `SETUP_SECRET` | any secret string | You choose — used once to register the webhook |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://aunkcnmplnunnercrvni.supabase.co` | Already in your Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API → anon key |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase → Settings → API → service_role key |
| `WEBAPP_URL` | `https://nova-hr-employee.vercel.app/webapp` | Your Vercel domain |
| `COMPANY_NAME` | `Nova HR SM` | Optional — customize company name |

### 2. Deploy

Push to GitHub — Vercel auto-deploys. Or click **Redeploy** in Vercel dashboard.

### 3. Register the Telegram webhook (once)

Open this URL in your browser after deploying (replace `YOUR_SECRET` with your `SETUP_SECRET`):

```
https://nova-hr-employee.vercel.app/api/setup-webhook?secret=YOUR_SECRET
```

You should see: `{"success":true,"webhook":"https://nova-hr-employee.vercel.app/api/telegram"}`

**Done.** Message your bot and it will respond immediately.

## Architecture

```
User → Telegram Bot → POST /api/telegram → telegram-webhook.ts
                                            ↓
                                     conversation_state (Supabase)
                                            ↓
                                     submissions table (Supabase)
                                            ↓
                                     cvs bucket (Supabase Storage)

User → Web App → /webapp/index.html
                 ↓ fetch /api/jobs        → jobs table
                 ↓ POST /api/upload       → submissions + cvs bucket
                 ↓ GET  /api/submissions  → user's own applications

Admin → /admin/index.html
        ↓ POST /api/admin/login           → session token
        ↓ GET  /api/submissions           → all applications
        ↓ PATCH /api/submissions/:id      → accept / reject / interview
        ↓ GET  /api/uploads/:file         → fresh signed CV URL (1hr)
        ↓ GET/POST/PUT/DELETE /api/jobs   → manage job listings
```

## Supabase tables required

- `jobs` — job listings
- `submissions` — applications (with `cv_path`, `status`, `interview`, `source`, `updated_at`)
- `conversation_state` — Telegram bot multi-step state per user
- `admin_sessions` — login tokens with expiry
- `login_attempts` — rate limiting

All were created/migrated via the Supabase MCP during setup.

## File structure

```
├── lib/
│   ├── api-handler.ts       CORS + error wrapper for all API routes
│   ├── auth.ts              Timing-safe admin token check + session validation
│   ├── env.ts               All environment variable exports
│   ├── supabase.ts          Anon + service role Supabase clients
│   ├── telegram.ts          Telegram Bot API helpers
│   ├── telegram-auth.ts     Verify Telegram WebApp initData (shared)
│   └── telegram-webhook.ts  Full bot conversation state machine
├── pages/api/
│   ├── admin/login.ts       POST — authenticate admin, return session token
│   ├── health.ts            GET  — health check
│   ├── jobs/
│   │   ├── index.ts         GET (public) / POST (admin) — list/create jobs
│   │   └── [jobId].ts       PUT / DELETE (admin) — edit/delete a job
│   ├── setup-webhook.ts     GET — register Telegram webhook (run once)
│   ├── submissions/
│   │   ├── index.ts         GET — all (admin) or user's own (Telegram auth)
│   │   └── [subId].ts       GET / PATCH — view or update a submission ← critical fix
│   ├── telegram.ts          POST — Telegram webhook receiver
│   ├── upload.ts            POST — receive form + files, store in Supabase
│   └── uploads/[filename].ts GET (admin) — generate fresh signed URL for CV
├── public/
│   ├── admin/index.html     Admin panel (single-file, dark modern UI)
│   └── webapp/
│       ├── index.html       Telegram Mini App HTML
│       ├── css/style.css    Mobile-first dark theme
│       ├── js/app.js        Full app logic — jobs, apply flow, CV upload, my apps
│       └── jobs.json        Fallback static jobs (if Supabase unreachable)
└── .env.example             All required environment variables documented

export const BOT_TOKEN              = process.env.BOT_TOKEN              || ""
export const ADMIN_CHAT_ID          = process.env.ADMIN_CHAT_ID          || ""
export const COMPANY_NAME           = process.env.COMPANY_NAME           || "Nova HR SM"
export const WEBAPP_URL             = process.env.WEBAPP_URL             || process.env.VERCEL_URL || ""
export const NEXT_PUBLIC_SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL      || ""
export const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
export const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY   || ""
export const ADMIN_TOKEN            = process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD || process.env.EMPLOYER_PASSWORD || ""

export default { BOT_TOKEN, ADMIN_CHAT_ID, COMPANY_NAME, WEBAPP_URL,
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ADMIN_TOKEN }

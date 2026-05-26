import { createClient } from "@supabase/supabase-js"
import { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY } from "./env"

function make(url: string, key: string) {
  try {
    return createClient(url, key, { auth: { persistSession: false } })
  } catch (err) {
    console.error("Supabase client init failed:", err)
    return null
  }
}

// Anon client — public read-only routes only
export const supabase =
  NEXT_PUBLIC_SUPABASE_URL && NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? make(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
    : null

// Service client — server-side writes (bypasses RLS)
export const supabaseAdmin =
  NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? make(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : supabase

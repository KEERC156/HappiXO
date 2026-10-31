import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const hasSupabaseSettings = Boolean(supabaseUrl || supabasePublishableKey)

export const isSupabaseConfigured = hasSupabaseSettings
let configurationError = hasSupabaseSettings
  ? ''
  : 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable account-backed event storage.'
let client: SupabaseClient | null = null

if (hasSupabaseSettings && (!supabaseUrl || !supabasePublishableKey)) {
  configurationError = 'Configure both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable HappiXO accounts.'
} else if (supabaseUrl && supabasePublishableKey) {
  try {
    const url = new URL(supabaseUrl)
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) throw new Error()
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  } catch {
    configurationError = 'The Supabase URL or publishable key is invalid. Check the project environment settings.'
  }
}

if (configurationError && import.meta.env.DEV) console.error(configurationError)

export const supabase = client
export const supabaseConfigurationError = configurationError

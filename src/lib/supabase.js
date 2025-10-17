import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = 'https://kyoowsarfopltjwmhksi.supabase.co'
export const supabaseAnonKey = 'REDACTED_JWT'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

